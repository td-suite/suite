// Piano ferie annuale (funzionamento stabilito dal CEO, 08/11/2026): il mio piano, il piano dell'area, periodi, invio, presa in carico,
// approvazione, definitivo, riapertura (per persona e per tutta l'area), variazioni al piano approvato.
// Chi fa cosa: il dipendente compila il proprio piano (BOZZA o PROPOSTO non ancora preso in carico) e lo invia; dopo l'approvazione
// propone solo variazioni. Approva il SUPERIORE DIRETTO dell'anagrafica (CEO, 09/11/2026: "Segui pedissequamente quanto indicato in
// organigramma"; lib/superiori.js), o il suo delegato: modifica i periodi dei diretti, approva, rende definitivo e riapre; i livelli sotto
// li vede in sola lettura ("La mia catena"). ADMIN (il CEO, HR con il grant) vede e fa tutto su tutti. Chi non ha nessuno sopra (il
// vertice, l'Owner) non ha approvazione: all'invio il piano diventa DEFINITIVO "senza approvatore in organigramma", e così le sue
// variazioni. Visibilità del piano per area: il dipendente vede la propria area (nomi e periodi dei colleghi, senza saldi né note).
import { Router } from 'express';
import { z } from 'zod';
import { q, one, tx } from '../db.js';
import { ah, parse, audit, notFound, forbidden, bad } from '../../../lib/util.js';
import { KEY, userContext, saldoPersona, calendarioPersona, evento, oggi } from '../lib/core.js';
import { pianoGruppo, chiusureGruppo, coperturaRichiesta, membriGruppo } from '../lib/piano.js';
import { nomeGruppo } from '../lib/perimetro.js';
import { alberoDi } from '../lib/superiori.js';
import { analizza, testoConflitti } from '../lib/periodi.js';
import {
  STATO_PIANO_LABEL, APERTI, CHIUSI, azioniPiano, statoPeriodo, statoDopoModifica, contaPerStato, assicuraPiani, pianiDi, loadPiano,
  periodiPiano, eventoPiano, eventiPiano, avvisaResponsabile, avvisaDipendente, descriviPeriodo, anniGestiti, NOTA_SENZA_APPROVATORE, approvazioneDi,
} from '../lib/pianoAnnuale.js';

const r = Router();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida (AAAA-MM-GG)');
const annoQ = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : Number(oggi().slice(0, 4)); };
const periodoSchema = z.object({
  data_inizio: data, data_fine: data,
  mezza_inizio: z.boolean().optional().default(false), mezza_fine: z.boolean().optional().default(false),
  note: z.string().trim().max(1000).optional().default(''),
  chiusura_id: z.coerce.number().int().positive().optional().nullable(),
  nota: z.string().trim().max(1000).optional().default(''),          // nota o motivo del responsabile
});
const notaSchema = z.object({ nota: z.string().trim().max(1000).optional().default('') });

// ---------------------------------------------------------------- contesto del piano
/**
 * Piano visibile all'utente, con la persona e i flag: proprio, gestisce (superiore diretto della persona, delegato o ADMIN), sola_lettura
 * (riporto dei livelli sotto: lo vede, non lo approva). Le azioni di chi non gestisce sono tutte false: le route rispondono 403.
 */
async function caricaPiano(ctx, id) {
  const piano = await loadPiano(Number(id));
  if (!piano) throw notFound('Piano non trovato');
  const persona = ctx.perim.persone.get(piano.person_id);
  if (!persona) throw bad('La persona di questo piano non è più nel perimetro del Piano Ferie (dipendenti attivi con contratto)');
  const proprio = piano.person_id === ctx.personId;
  const gestisce = ctx.puoGestire(piano.person_id);
  if (!(proprio || gestisce || ctx.tutto || ctx.catena.has(piano.person_id))) throw forbidden(`Piano di un'altra persona: lo approva ${persona.approvatore_nome || 'l\'amministratore'} (superiore diretto in anagrafica)`);
  return { piano, persona, proprio, gestisce, sola_lettura: !proprio && !gestisce, azioni: azioniPiano(piano.stato, { proprio, gestisce }) };
}
/** Errore delle azioni del responsabile su un piano che l'utente non gestisce: dice chi lo approva */
const nonTuo = (c) => forbidden(`Il piano di ${c.persona.nome} lo approva ${c.persona.approvatore_nome || 'l\'amministratore'} (superiore diretto in anagrafica)${c.sola_lettura ? ': tu lo vedi in sola lettura' : ''}`);

/** Aggiorna lo stato del piano dopo una modifica dei periodi; versione +1 per i piani già approvati */
async function dopoModifica(ctx, c, { tipo, dati, client }) {
  const resp = c.gestisce;
  const nuovo = statoDopoModifica(c.piano.stato, { daResponsabile: resp });
  const run = client ? client.query.bind(client) : q;
  if (nuovo !== c.piano.stato) {
    await run(`UPDATE piani SET stato=$2, in_revisione_da=$3, updated_at=now() WHERE id=$1`, [c.piano.id, nuovo, ctx.uid]);
    await eventoPiano(c.piano.id, 'IN_REVISIONE', ctx.uid, { da: c.piano.stato }, client);
  } else if (CHIUSI.includes(c.piano.stato)) {
    await run(`UPDATE piani SET versione = versione + 1, updated_at=now() WHERE id=$1`, [c.piano.id]);
  } else await run(`UPDATE piani SET updated_at=now() WHERE id=$1`, [c.piano.id]);
  await eventoPiano(c.piano.id, c.piano.stato === 'DEFINITIVO' && resp ? 'VARIAZIONE' : tipo, ctx.uid, { ...dati, da_responsabile: resp || undefined }, client);
  return nuovo;
}

/** Controlli comuni prima di scrivere un periodo: chi può e con quali vincoli */
function verificaScrittura(ctx, c, b) {
  if (!c.proprio && !c.gestisce) throw nonTuo(c);
  if (!(c.azioni.modifica || c.azioni.modifica_con_motivo)) {
    if (c.proprio && CHIUSI.includes(c.piano.stato)) throw forbidden('Il piano è approvato: proponi una variazione al responsabile');
    if (c.proprio && c.piano.stato === 'IN_REVISIONE') throw forbidden('Il responsabile sta rivedendo il tuo piano: le modifiche ora le fa lui');
    throw forbidden('Non puoi modificare questo piano');
  }
  if (c.azioni.modifica_con_motivo && (b.nota || '').length < 3) throw bad('Il piano è definitivo: scrivi il motivo della modifica (lo legge il dipendente)');
  if (!c.gestisce && b.data_inizio && b.data_inizio < oggi()) throw bad('Non puoi pianificare giorni già passati: li registra il responsabile');
}

// ---------------------------------------------------------------- il mio piano
r.get('/mio-piano', ah(async (req, res) => {
  const ctx = await userContext(req);
  const anno = annoQ(req.query.anno);
  const p = ctx.me;
  const base = { anno, anni: anniGestiti(), settings: { rol_attivi: Boolean(ctx.settings.rol_attivi), avviso_dipendenti: ctx.settings.avviso_dipendenti || '' }, contratti: ctx.perim.contratti };
  if (!p) {
    const motivo = !ctx.perim.contratti ? 'Il modulo Contratti del personale non è ancora avviato: il perimetro dei dipendenti non è disponibile.'
      : !ctx.personId ? 'Il tuo account non è collegato a una persona dell\'anagrafica.'
      : 'Il Piano Ferie riguarda i dipendenti attivi con contratto di lavoro subordinato in Contratti del personale.';
    return res.json({ ...base, fuori_perimetro: true, motivo });
  }
  await assicuraPiani([p.id], anno, null);
  const [piano] = await pianiDi([p.id], anno);
  const saldo = await saldoPersona(p, anno, ctx.settings);
  const periodi = piano ? await periodiPiano(piano.id, { storico: true }) : [];
  const chiusure = await chiusureGruppo(p.gruppo, `${anno}-01-01`, `${anno}-12-31`);
  const cal = await calendarioPersona(p, [anno], ctx.settings);
  const attivi = periodi.filter((x) => ['PIANIFICATA', 'RICHIESTA', 'APPROVATA', 'GODUTA'].includes(x.stato));
  const gestisce = ctx.puoGestire(p.id);
  res.json({
    ...base,
    persona: { id: p.id, nome: p.nome, gruppo: p.gruppo, gruppo_nome: nomeGruppo(p.gruppo, ctx.perim.siti), area_origine: p.area_origine, ruolo: p.role_name, contratto: p.contratto, inizio: p.inizio, fine: p.fine,
      ...approvazioneDi(p) },
    piano: piano ? { ...piano, stato_label: STATO_PIANO_LABEL[piano.stato], azioni: azioniPiano(piano.stato, { proprio: true, gestisce }), eventi: await eventiPiano(piano.id) } : null,
    scadenza: (ctx.settings.scadenze_piano || {})[String(anno)] || null,
    saldo, periodi: attivi, storico: periodi.filter((x) => !attivi.includes(x)),
    chiusure: chiusure.map((c) => ({ ...c, nel_piano: attivi.some((x) => x.data_inizio <= c.data_fine && x.data_fine >= c.data_inizio) })),
    festivi: [...cal.festivi.entries()].filter(([d]) => d.startsWith(String(anno))).map(([d, n]) => ({ data: d, nome: n })), settimana: cal.settimana_etichetta, settimana_giorni: cal.settimana,
    oggi: oggi(),
  });
}));

// ---------------------------------------------------------------- aree visibili e piano dell'area
r.get('/aree', ah(async (req, res) => {
  const ctx = await userContext(req);
  const anno = annoQ(req.query.anno);
  const conta = new Map();
  for (const p of ctx.perim.persone.values()) conta.set(p.gruppo, (conta.get(p.gruppo) || 0) + 1);
  const visibili = ctx.perim.gruppi.filter((g) => ctx.vedeGruppo(g.key));
  const ids = [...ctx.perim.persone.values()].filter((p) => visibili.some((g) => g.key === p.gruppo)).map((p) => p.id);
  const piani = await pianiDi(ids, anno);
  const byPerson = new Map(piani.map((x) => [x.person_id, x]));
  res.json({
    anno, contratti: ctx.perim.contratti, tutto: ctx.tutto, admin: ctx.isAdmin,
    aree: visibili.map((g) => {
      const membri = [...ctx.perim.persone.values()].filter((p) => p.gruppo === g.key);
      const gestite = ctx.isAdmin || ctx.areeGestite.has(g.key);
      return { ...g, persone: conta.get(g.key) || 0, mia: ctx.me?.gruppo === g.key, gestita: gestite,
        stati: ctx.tutto || gestite ? contaPerStato(membri.map((m) => byPerson.get(m.id) || { stato: 'BOZZA' })) : undefined };
    }),
  });
}));

/** Dati del piano di un'area per un anno, filtrati per chi guarda */
async function datiArea(ctx, gruppo, anno) {
  const membri = membriGruppo(ctx.perim, gruppo);
  const ids = membri.map((m) => m.id);
  await assicuraPiani(ids, anno, null);
  const piani = new Map((await pianiDi(ids, anno)).map((x) => [x.person_id, x]));
  const pg = await pianoGruppo(ctx.perim, gruppo, `${anno}-01-01`, `${anno}-12-31`, { s: ctx.settings });
  const persone = [];
  for (const m of membri) {
    const p = ctx.perim.persone.get(m.id);
    const pi = piani.get(m.id) || null;
    const dettagli = ctx.vedeSaldo(m.id);
    const gestisce = ctx.puoGestire(m.id);
    persone.push({
      id: m.id, nome: m.nome, ruolo: m.role_name, settimana: m.settimana, io: m.id === ctx.personId, gestisce,
      // chi approva, letto dall'anagrafica (superiore diretto, con la risalita); sola lettura = riporto dei livelli sotto
      approva: p.vertice ? 'nessuno (vertice)' : p.approvatore_nome || 'amministratore', approva_origine: p.approvatore_origine,
      senza_superiore: p.senza_superiore && !p.vertice ? true : undefined, sola_lettura: ctx.soloLettura(m.id) || undefined,
      piano: pi ? { id: pi.id, stato: pi.stato, stato_label: STATO_PIANO_LABEL[pi.stato], versione: pi.versione, inviato_at: pi.inviato_at, approvato_at: pi.approvato_at, definitivo_at: pi.definitivo_at,
        note: dettagli ? pi.note : undefined, approvato_da_nome: dettagli ? pi.approvato_da_nome : undefined,
        azioni: pi ? azioniPiano(pi.stato, { proprio: m.id === ctx.personId, gestisce }) : null } : null,
      saldo: dettagli ? await saldoPersona(p, anno, ctx.settings) : undefined,
      ha_accesso: dettagli ? Boolean(p.user_id) : undefined,
    });
  }
  // periodi: i colleghi vedono date e stato, mai note e giorni; le variazioni in attesa le vedono solo il dipendente e il responsabile
  const periodi = pg.assenze.filter((a) => a.stato !== 'RICHIESTA' || ctx.vedeSaldo(a.person_id))
    .map((a) => (ctx.vedeSaldo(a.person_id) ? a : { ...a, note: undefined, giorni: undefined, ore: undefined, variazione_proposta: undefined }));
  const nomi = new Map(membri.map((m) => [m.id, m.nome]));
  const variazioni = [];
  for (const a of pg.assenze) {
    if (!ctx.puoDecidere(a.person_id)) continue;
    if (a.stato === 'RICHIESTA' || a.variazione_proposta) variazioni.push({ ...a, persona: nomi.get(a.person_id) });
  }
  const gestiti = persone.filter((x) => x.gestisce && x.piano);
  return {
    gruppo, nome: pg.nome, anno, site_kind: pg.site_kind, persone, periodi, chiusure: pg.chiusure, festivi: pg.festivi, regole: pg.regole, scoperture: pg.scoperture,
    variazioni, stati: contaPerStato(persone.map((x) => x.piano).filter(Boolean)),
    gestisce: gestiti.length > 0,
    azioni: {
      approva_area: gestiti.filter((x) => ['PROPOSTO', 'IN_REVISIONE'].includes(x.piano.stato)).length,
      definitivi_area: gestiti.filter((x) => x.piano.stato === 'APPROVATO').length,
    },
    scadenza: (ctx.settings.scadenze_piano || {})[String(anno)] || null,
    oggi: oggi(),
  };
}

r.get('/area', ah(async (req, res) => {
  const ctx = await userContext(req);
  const anno = annoQ(req.query.anno);
  const gruppo = String(req.query.gruppo || ctx.me?.gruppo || [...ctx.areeGestite][0] || ctx.gruppi[0] || '');
  if (!gruppo) return res.json({ gruppo: null, anno, persone: [], periodi: [], chiusure: [], festivi: [], regole: [], scoperture: [], variazioni: [], stati: {}, azioni: {} });
  if (!ctx.vedeGruppo(gruppo)) throw forbidden('Piano di un\'altra area: ogni dipendente vede solo la propria area');
  res.json(await datiArea(ctx, gruppo, anno));
}));

// ---------------------------------------------------------------- la mia catena
// Albero dei riporti dell'utente secondo l'anagrafica (superiore diretto, "Dipende da"), con lo stato del piano e i saldi di ciascuno:
// i diretti li approva l'utente (azioni), i livelli sotto li vede in sola lettura con "approva: <nome>". L'ADMIN può partire da
// qualunque persona (?person_id); senza persona collegata parte dal vertice.
r.get('/catena', ah(async (req, res) => {
  const ctx = await userContext(req);
  const anno = annoQ(req.query.anno);
  const nodi = ctx.perim.nodi || new Map();
  let radice = ctx.personId || null;
  if (ctx.tutto && req.query.person_id) radice = Number(req.query.person_id) || radice;
  if (!radice && ctx.tutto) radice = [...nodi.values()].find((n) => !n.manager_id && n.owner)?.id || [...nodi.values()].find((n) => !n.manager_id)?.id || null;
  if (!radice) return res.json({ anno, radice: null, motivo: 'Il tuo account non è collegato a una persona dell\'anagrafica.' });
  if (!ctx.tutto && radice !== ctx.personId) throw forbidden('Vedi solo la tua catena');
  const albero = alberoDi(radice, nodi, { figli: ctx.perim.figli });
  const ids = []; const giro = (n) => { ids.push(n.id); n.figli.forEach(giro); }; giro(albero);
  const inPerimetro = ids.filter((id) => ctx.perim.persone.has(id));
  await assicuraPiani(inPerimetro, anno, null);
  const piani = new Map((await pianiDi(inPerimetro, anno)).map((x) => [x.person_id, x]));
  const fuori = ids.filter((id) => !nodi.has(id));
  const nomiFuori = new Map(fuori.length ? (await q('SELECT id, last_name || \' \' || first_name AS nome FROM public.people WHERE id = ANY($1::int[])', [fuori])).rows.map((x) => [x.id, x.nome]) : []);
  const conta = { persone: 0, diretti: 0, stati: {} };
  const arricchisci = async (n) => {
    const nodo = nodi.get(n.id) || { id: n.id, nome: nomiFuori.get(n.id) || `persona ${n.id}`, attivo: true };
    const p = ctx.perim.persone.get(n.id) || null;
    const pi = p ? piani.get(n.id) || null : null;
    const gestisce = p ? ctx.puoGestire(n.id) : false;
    const io = n.id === ctx.personId;
    const diretto = ctx.approva.has(n.id);
    if (p && !io) { conta.persone++; if (diretto) conta.diretti++; if (pi) conta.stati[pi.stato] = (conta.stati[pi.stato] || 0) + 1; }
    const sal = p && ctx.vedeSaldo(n.id) ? await saldoPersona(p, anno, ctx.settings) : null;
    return {
      id: n.id, nome: nodo.nome, livello: n.livello, io, in_perimetro: Boolean(p), cessato: nodo.attivo === false, senza_accesso: nodo.attivo !== false && !nodo.user_id,
      ruolo: p?.role_name || null, gruppo: p?.gruppo || null, gruppo_nome: p ? nomeGruppo(p.gruppo, ctx.perim.siti) : null,
      // diretto = l'utente è il superiore diretto (o il delegato); l'ADMIN interviene anche sugli altri (azioni) senza che siano suoi diretti
      ...(p ? approvazioneDi(p) : {}), diretto, interviene_admin: gestisce && !diretto, sola_lettura: Boolean(p) && !io && !gestisce,
      piano: pi ? { id: pi.id, stato: pi.stato, stato_label: STATO_PIANO_LABEL[pi.stato], versione: pi.versione, inviato_at: pi.inviato_at, approvato_at: pi.approvato_at, definitivo_at: pi.definitivo_at, nota_approvatore: pi.nota_approvatore,
        azioni: azioniPiano(pi.stato, { proprio: io, gestisce }) } : null,
      saldo: sal ? { spettanza: sal.spettanza, residuo_ap: sal.residuo_ap, pianificato_totale: sal.pianificato_totale, goduto: sal.goduto, da_pianificare: sal.da_pianificare, in_attesa: sal.in_attesa } : null,
      figli: await Promise.all(n.figli.map(arricchisci)),
    };
  };
  const out = await arricchisci(albero);
  // per l'ADMIN: chi ha riporti, per scegliere da dove partire
  const radici = ctx.tutto ? [...nodi.values()].filter((n) => (ctx.perim.figli.get(n.id) || []).length).map((n) => ({ id: n.id, nome: n.nome, riporti: ctx.perim.figli.get(n.id).length })).sort((a, b) => a.nome.localeCompare(b.nome, 'it')) : [];
  res.json({ anno, anni: anniGestiti(), radice: out, conta, admin: ctx.tutto, radici });
}));

// ---------------------------------------------------------------- periodi del piano
r.post('/piani/:id/calcola', ah(async (req, res) => {
  const ctx = await userContext(req);
  const c = await caricaPiano(ctx, req.params.id);
  const b = parse(periodoSchema.extend({ escludi_id: z.coerce.number().int().positive().optional().nullable() }), req.body || {});
  const a = await analizza(ctx, c.persona, { ...b, tipo: 'FERIE' }, b.escludi_id || null);
  res.json({ ...a, saldo: undefined, da_pianificare: a.saldo.da_pianificare });
}));

/** Periodo nel piano con il conteggio e la copertura; ritorna la riga */
async function salvaPeriodo(ctx, c, b, { esistente = null } = {}) {
  if (Number(b.data_inizio.slice(0, 4)) !== c.piano.anno || Number(b.data_fine.slice(0, 4)) !== c.piano.anno) throw bad(`Il periodo deve stare nell'anno del piano (${c.piano.anno})`);
  const a = await analizza(ctx, c.persona, { ...b, tipo: 'FERIE' }, esistente?.id || null);
  if (a.conflitti.length) throw bad(testoConflitti(a.conflitti));
  if (b.chiusura_id && !(await one(`SELECT 1 FROM chiusure WHERE id=$1 AND (gruppo=$2 OR gruppo='TUTTE')`, [b.chiusura_id, c.persona.gruppo]))) throw bad('Chiusura collettiva non valida per quest\'area');
  const cop = await coperturaRichiesta(ctx.perim, { id: esistente?.id || null, tipo: 'FERIE', data_inizio: b.data_inizio, data_fine: b.data_fine, mezza_inizio: b.mezza_inizio, mezza_fine: b.mezza_fine }, c.persona, a.dettaglio, ctx.settings);
  const stato = statoPeriodo(statoDopoModifica(c.piano.stato, { daResponsabile: c.gestisce }), b.data_fine, oggi());
  return tx(async (cl) => {
    let row;
    if (esistente) {
      row = (await cl.query(`UPDATE richieste SET data_inizio=$2, data_fine=$3, mezza_inizio=$4, mezza_fine=$5, giorni=$6, note=$7, stato=$8, sotto_copertura=$9, copertura=$10,
          chiusura_id=$11, modificata_da_user_id=$12, modificata_at=now(), deciso_da_user_id=CASE WHEN $8 IN ('APPROVATA','GODUTA') THEN $12 ELSE deciso_da_user_id END,
          deciso_at=CASE WHEN $8 IN ('APPROVATA','GODUTA') THEN now() ELSE deciso_at END, goduta_at=CASE WHEN $8='GODUTA' THEN now() END, updated_at=now() WHERE id=$1 RETURNING *`,
      [esistente.id, b.data_inizio, b.data_fine, b.mezza_inizio, b.mezza_fine, a.giorni, b.note ?? esistente.note, stato, cop.length > 0, JSON.stringify(cop), b.chiusura_id || null, ctx.uid])).rows[0];
      await evento(row.id, 'MODIFICA', ctx.uid, { prima: { dal: esistente.data_inizio, al: esistente.data_fine, giorni: esistente.giorni }, dopo: { dal: b.data_inizio, al: b.data_fine, giorni: a.giorni }, nota: b.nota || undefined }, cl);
    } else {
      row = (await cl.query(`INSERT INTO richieste (person_id, anno, tipo, data_inizio, data_fine, mezza_inizio, mezza_fine, giorni, note, stato, gruppo, approvatore_person_id, chiusura_id,
          inserita_da_user_id, sotto_copertura, copertura, piano_id, deciso_da_user_id, deciso_at, goduta_at)
        VALUES ($1,$2,'FERIE',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [c.persona.id, c.piano.anno, b.data_inizio, b.data_fine, b.mezza_inizio, b.mezza_fine, a.giorni, b.note || '', stato, c.persona.gruppo, c.persona.approvatore_id || null, b.chiusura_id || null, ctx.uid,
        cop.length > 0, JSON.stringify(cop), c.piano.id, stato === 'PIANIFICATA' ? null : ctx.uid, stato === 'PIANIFICATA' ? null : new Date(), stato === 'GODUTA' ? new Date() : null])).rows[0];
      await evento(row.id, 'PIANIFICATA', ctx.uid, { giorni: a.giorni, da_responsabile: c.gestisce && !c.proprio ? true : undefined, sotto_copertura: cop.length || undefined, nota: b.nota || undefined }, cl);
    }
    await dopoModifica(ctx, c, { tipo: esistente ? 'PERIODO_MODIFICATO' : 'PERIODO_AGGIUNTO', dati: { periodo_id: row.id, dal: b.data_inizio, al: b.data_fine, giorni: a.giorni, nota: b.nota || undefined, prima: esistente ? { dal: esistente.data_inizio, al: esistente.data_fine } : undefined }, client: cl });
    return { row, avvisi: a.avvisi, copertura: cop };
  });
}

/** Avviso al dipendente quando il responsabile tocca il suo piano */
async function avvisaModifica(ctx, c, testo, nota) {
  if (c.proprio || !c.gestisce) return;
  await avvisaDipendente(c.persona, c.piano, { evento: 'modifica', title: `Il tuo piano ferie ${c.piano.anno} è stato modificato`, body: `${testo}${nota ? ` · ${nota}` : ''}`, exclude: [ctx.uid] });
}

r.post('/piani/:id/periodi', ah(async (req, res) => {
  const ctx = await userContext(req);
  const c = await caricaPiano(ctx, req.params.id);
  const b = parse(periodoSchema, req.body || {});
  verificaScrittura(ctx, c, b);
  const { row, avvisi, copertura } = await salvaPeriodo(ctx, c, b);
  await audit(req, 'FERIE_PIANO_PERIODO', { module: KEY, entity: 'piano', entityId: c.piano.id, label: `${c.persona.nome} ${c.piano.anno}: aggiunto ${descriviPeriodo(row)}`, data: { periodo_id: row.id, nota: b.nota || undefined } });
  await avvisaModifica(ctx, c, `Aggiunto il periodo ${descriviPeriodo(row)}`, b.nota);
  res.status(201).json({ ...row, avvisi, copertura });
}));

async function periodoDelPiano(c, rid) {
  const x = await one('SELECT * FROM richieste WHERE id=$1 AND piano_id=$2', [Number(rid), c.piano.id]);
  if (!x) throw notFound('Periodo non trovato in questo piano');
  if (!['PIANIFICATA', 'APPROVATA', 'GODUTA'].includes(x.stato)) throw bad('Il periodo non è più attivo nel piano');
  if (x.tipo !== 'FERIE') throw bad('I permessi ROL non sono periodi del piano');
  return x;
}

r.put('/piani/:id/periodi/:rid', ah(async (req, res) => {
  const ctx = await userContext(req);
  const c = await caricaPiano(ctx, req.params.id);
  const x = await periodoDelPiano(c, req.params.rid);
  const b = parse(periodoSchema, { note: x.note, ...req.body });
  verificaScrittura(ctx, c, b);
  if (!c.gestisce && x.data_inizio < oggi()) throw bad('Il periodo è già iniziato: lo modifica il responsabile');
  const { row, avvisi, copertura } = await salvaPeriodo(ctx, c, b, { esistente: x });
  await audit(req, 'FERIE_PIANO_PERIODO', { module: KEY, entity: 'piano', entityId: c.piano.id, label: `${c.persona.nome} ${c.piano.anno}: spostato ${descriviPeriodo(x)} → ${descriviPeriodo(row)}`, data: { periodo_id: row.id, nota: b.nota || undefined } });
  await avvisaModifica(ctx, c, `Periodo ${descriviPeriodo(x)} spostato a ${descriviPeriodo(row)}`, b.nota);
  res.json({ ...row, avvisi, copertura });
}));

r.delete('/piani/:id/periodi/:rid', ah(async (req, res) => {
  const ctx = await userContext(req);
  const c = await caricaPiano(ctx, req.params.id);
  const x = await periodoDelPiano(c, req.params.rid);
  const b = parse(notaSchema, req.body || {});
  verificaScrittura(ctx, c, { nota: b.nota });
  if (!c.gestisce && x.data_inizio < oggi()) throw bad('Il periodo è già iniziato: lo toglie il responsabile');
  await tx(async (cl) => {
    await cl.query(`UPDATE richieste SET stato='ANNULLATA', annullata_da_user_id=$2, annullata_at=now(), nota_decisione=coalesce(nullif($3,''), nota_decisione), variazione_proposta=NULL, updated_at=now() WHERE id=$1`, [x.id, ctx.uid, b.nota]);
    await evento(x.id, 'ANNULLATA', ctx.uid, { da_stato: x.stato, motivo: b.nota || undefined, tolto_dal_piano: true }, cl);
    await dopoModifica(ctx, c, { tipo: 'PERIODO_TOLTO', dati: { periodo_id: x.id, dal: x.data_inizio, al: x.data_fine, giorni: x.giorni, nota: b.nota || undefined }, client: cl });
  });
  await audit(req, 'FERIE_PIANO_PERIODO', { module: KEY, entity: 'piano', entityId: c.piano.id, label: `${c.persona.nome} ${c.piano.anno}: tolto ${descriviPeriodo(x)}`, data: { periodo_id: x.id, nota: b.nota || undefined } });
  await avvisaModifica(ctx, c, `Tolto il periodo ${descriviPeriodo(x)}`, b.nota);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- stati del piano
r.post('/piani/:id/invia', ah(async (req, res) => {
  const ctx = await userContext(req);
  const c = await caricaPiano(ctx, req.params.id);
  const b = parse(z.object({ note: z.string().trim().max(1000).optional().default('') }), req.body || {});
  if (!c.azioni.invia) throw forbidden(c.proprio ? `Il piano è già ${STATO_PIANO_LABEL[c.piano.stato].toLowerCase()}` : 'Il piano lo invia il dipendente');
  const n = (await one(`SELECT count(*)::int AS n, coalesce(sum(giorni),0) AS g FROM richieste WHERE piano_id=$1 AND tipo='FERIE' AND stato IN ('PIANIFICATA','APPROVATA','GODUTA')`, [c.piano.id]));
  const dati = { periodi: n.n, giorni: Number(n.g) };
  // Chi non ha nessuno sopra (il vertice, l'Owner): nessuna approvazione, il piano diventa subito DEFINITIVO
  if (c.persona.vertice) {
    const g = oggi();
    await tx(async (cl) => {
      const upd = await cl.query(`UPDATE piani SET stato='DEFINITIVO', inviato_at=now(), inviato_da=$2, note=coalesce(nullif($3,''), note), approvato_at=now(), approvato_da=NULL,
          definitivo_at=now(), definitivo_da=NULL, nota_approvatore=$4, versione=versione+1, promemoria_at=NULL, updated_at=now() WHERE id=$1 AND stato='BOZZA'`, [c.piano.id, ctx.uid, b.note, NOTA_SENZA_APPROVATORE]);
      if (!upd.rowCount) throw bad('Il piano è cambiato nel frattempo: ricarica la pagina');
      const per = (await cl.query(`UPDATE richieste SET stato = CASE WHEN data_fine < $2::date THEN 'GODUTA' ELSE 'APPROVATA' END, deciso_da_user_id=NULL, deciso_at=now(),
          approvatore_person_id=NULL, goduta_at = CASE WHEN data_fine < $2::date THEN now() END, updated_at=now() WHERE piano_id=$1 AND stato='PIANIFICATA' RETURNING id`, [c.piano.id, g])).rows;
      for (const x of per) await evento(x.id, 'APPROVATA', ctx.uid, { con_il_piano: true, senza_approvatore: true, nota: NOTA_SENZA_APPROVATORE }, cl);
      await eventoPiano(c.piano.id, 'INVIATO', ctx.uid, { ...dati, note: b.note || undefined }, cl);
      await eventoPiano(c.piano.id, 'DEFINITIVO', ctx.uid, { senza_approvatore: true, nota: NOTA_SENZA_APPROVATORE, periodi: per.length }, cl);
    });
    await audit(req, 'FERIE_PIANO_DEFINITIVO', { module: KEY, entity: 'piano', entityId: c.piano.id, label: `${c.persona.nome} ${c.piano.anno}: ${NOTA_SENZA_APPROVATORE}`, data: { ...dati, senza_approvatore: true } });
    return res.json({ ...(await loadPiano(c.piano.id)), avviso: `Piano definitivo: ${NOTA_SENZA_APPROVATORE}, nessuna approvazione richiesta.` });
  }
  const upd = await q(`UPDATE piani SET stato='PROPOSTO', inviato_at=now(), inviato_da=$2, note=coalesce(nullif($3,''), note), promemoria_at=NULL, updated_at=now() WHERE id=$1 AND stato='BOZZA'`, [c.piano.id, ctx.uid, b.note]);
  if (!upd.rowCount) throw bad('Il piano è cambiato nel frattempo: ricarica la pagina');
  await q(`UPDATE richieste SET approvatore_person_id=$2, updated_at=now() WHERE piano_id=$1 AND stato IN ('PIANIFICATA','RICHIESTA') AND approvatore_person_id IS DISTINCT FROM $2`, [c.piano.id, c.persona.approvatore_id || null]);
  await eventoPiano(c.piano.id, 'INVIATO', ctx.uid, { ...dati, note: b.note || undefined, approvatore: c.persona.approvatore_nome || undefined, approvatore_origine: c.persona.approvatore_origine || undefined });
  await audit(req, 'FERIE_PIANO_INVIATO', { module: KEY, entity: 'piano', entityId: c.piano.id, label: `${c.persona.nome} ${c.piano.anno}`, data: { ...dati, approvatore_person_id: c.persona.approvatore_id || null } });
  const senza = !c.persona.approvatore_id;
  await avvisaResponsabile(c.persona, c.piano, { evento: 'invio', title: `${c.persona.nome} ha inviato il piano ferie ${c.piano.anno}`,
    body: `${n.n} ${n.n === 1 ? 'periodo' : 'periodi'}, ${Number(n.g).toLocaleString('it-IT')} giorni${b.note ? ` · ${b.note}` : ''}${senza ? ` · ATTENZIONE: ${c.persona.approvatore_origine}` : ''}`, exclude: [ctx.uid] });
  const avviso = c.persona.senza_superiore
    ? 'Non hai un superiore in anagrafica ("Dipende da" vuoto in Amministrazione > Persone): il piano non può essere approvato dal responsabile finché non viene indicato. L\'amministratore è stato avvisato.'
    : c.persona.approvatore_irraggiungibile ? `Nessun superiore attivo con accesso alla Suite (${c.persona.approvatore_origine}): l'amministratore è stato avvisato.`
      : c.persona.approvatore_saltati?.length ? `Inviato a ${c.persona.approvatore_nome}: ${c.persona.approvatore_origine}.` : null;
  res.json({ ...(await loadPiano(c.piano.id)), avviso });
}));

r.post('/piani/:id/prendi-in-carico', ah(async (req, res) => {
  const ctx = await userContext(req);
  const c = await caricaPiano(ctx, req.params.id);
  if (!c.azioni.prendi_in_carico) throw c.gestisce ? forbidden('Si prende in carico un piano inviato') : nonTuo(c);
  await q(`UPDATE piani SET stato='IN_REVISIONE', in_revisione_da=$2, updated_at=now() WHERE id=$1 AND stato='PROPOSTO'`, [c.piano.id, ctx.uid]);
  await eventoPiano(c.piano.id, 'IN_REVISIONE', ctx.uid, { da: 'PROPOSTO' });
  res.json(await loadPiano(c.piano.id));
}));

/** Approvazione di un piano (anche in blocco): i periodi PIANIFICATA diventano APPROVATA (GODUTA se già passati) */
async function approvaPiano(ctx, c, nota) {
  if (!c.azioni.approva) throw c.gestisce ? forbidden(`Il piano è già ${STATO_PIANO_LABEL[c.piano.stato].toLowerCase()}`) : nonTuo(c);
  const g = oggi();
  const n = await tx(async (cl) => {
    const upd = await cl.query(`UPDATE piani SET stato='APPROVATO', approvato_at=now(), approvato_da=$2, nota_approvatore=nullif($3,''), versione=versione+1, updated_at=now() WHERE id=$1 AND stato = ANY($4::text[])`, [c.piano.id, ctx.uid, nota, APERTI]);
    if (!upd.rowCount) throw bad('Il piano è cambiato nel frattempo: ricarica la pagina');
    const per = (await cl.query(`UPDATE richieste SET stato = CASE WHEN data_fine < $2::date THEN 'GODUTA' ELSE 'APPROVATA' END, deciso_da_user_id=$3, deciso_at=now(),
        goduta_at = CASE WHEN data_fine < $2::date THEN now() END, updated_at=now() WHERE piano_id=$1 AND stato='PIANIFICATA' RETURNING id, stato`, [c.piano.id, g, ctx.uid])).rows;
    for (const x of per) await evento(x.id, 'APPROVATA', ctx.uid, { con_il_piano: true }, cl);
    await eventoPiano(c.piano.id, 'APPROVATO', ctx.uid, { nota: nota || undefined, periodi: per.length, da: c.piano.stato }, cl);
    return per.length;
  });
  await avvisaDipendente(c.persona, c.piano, { evento: 'approvato', title: `Piano ferie ${c.piano.anno} approvato`, body: nota || `${n} ${n === 1 ? 'periodo approvato' : 'periodi approvati'}`, exclude: [ctx.uid] });
  return n;
}
async function definitivoPiano(ctx, c, nota) {
  if (!c.azioni.definitivo) throw c.gestisce ? forbidden('Si rende definitivo un piano approvato') : nonTuo(c);
  const upd = await q(`UPDATE piani SET stato='DEFINITIVO', definitivo_at=now(), definitivo_da=$2, nota_approvatore=coalesce(nullif($3,''), nota_approvatore), versione=versione+1, updated_at=now() WHERE id=$1 AND stato='APPROVATO'`, [c.piano.id, ctx.uid, nota]);
  if (!upd.rowCount) throw bad('Il piano è cambiato nel frattempo: ricarica la pagina');
  await eventoPiano(c.piano.id, 'DEFINITIVO', ctx.uid, { nota: nota || undefined });
  await avvisaDipendente(c.persona, c.piano, { evento: 'definitivo', title: `Piano ferie ${c.piano.anno} definitivo`, body: nota || 'Da ora le modifiche passano dal responsabile come variazioni', exclude: [ctx.uid] });
}

r.post('/piani/:id/approva', ah(async (req, res) => {
  const ctx = await userContext(req);
  const c = await caricaPiano(ctx, req.params.id);
  const b = parse(notaSchema, req.body || {});
  const n = await approvaPiano(ctx, c, b.nota);
  await audit(req, 'FERIE_PIANO_APPROVATO', { module: KEY, entity: 'piano', entityId: c.piano.id, label: `${c.persona.nome} ${c.piano.anno}`, data: { periodi: n } });
  res.json(await loadPiano(c.piano.id));
}));
r.post('/piani/:id/definitivo', ah(async (req, res) => {
  const ctx = await userContext(req);
  const c = await caricaPiano(ctx, req.params.id);
  const b = parse(notaSchema, req.body || {});
  await definitivoPiano(ctx, c, b.nota);
  await audit(req, 'FERIE_PIANO_DEFINITIVO', { module: KEY, entity: 'piano', entityId: c.piano.id, label: `${c.persona.nome} ${c.piano.anno}` });
  res.json(await loadPiano(c.piano.id));
}));
r.post('/piani/:id/riapri', ah(async (req, res) => {
  const ctx = await userContext(req);
  const c = await caricaPiano(ctx, req.params.id);
  const b = parse(z.object({ nota: z.string().trim().min(3, 'Scrivi il motivo della riapertura').max(1000) }), req.body || {});
  if (!c.azioni.riapri) throw c.gestisce ? forbidden('Si riapre un piano definitivo') : nonTuo(c);
  const upd = await q(`UPDATE piani SET stato='APPROVATO', definitivo_at=NULL, definitivo_da=NULL, nota_approvatore=$2, versione=versione+1, updated_at=now() WHERE id=$1 AND stato='DEFINITIVO'`, [c.piano.id, b.nota]);
  if (!upd.rowCount) throw bad('Il piano è cambiato nel frattempo: ricarica la pagina');
  await eventoPiano(c.piano.id, 'RIAPERTO', ctx.uid, { motivo: b.nota });
  await audit(req, 'FERIE_PIANO_RIAPERTO', { module: KEY, entity: 'piano', entityId: c.piano.id, label: `${c.persona.nome} ${c.piano.anno}`, data: { motivo: b.nota } });
  await avvisaDipendente(c.persona, c.piano, { evento: 'riaperto', title: `Piano ferie ${c.piano.anno} riaperto dal responsabile`, body: b.nota, exclude: [ctx.uid] });
  res.json(await loadPiano(c.piano.id));
}));

// In blocco su tutta l'area: "Approva tutta l'area" (piani inviati o in revisione) e "Rendi definitivi" (piani approvati)
const areaSchema = z.object({ gruppo: z.string().min(1), anno: z.coerce.number().int().min(2000).max(2100), nota: z.string().trim().max(1000).optional().default('') });
async function inBlocco(req, res, azione) {
  const ctx = await userContext(req);
  const b = parse(areaSchema, req.body || {});
  if (!ctx.vedeGruppo(b.gruppo)) throw forbidden('Area non tua');
  const membri = membriGruppo(ctx.perim, b.gruppo).filter((m) => ctx.puoGestire(m.id));
  if (!membri.length) throw forbidden('Non approvi il piano di nessun dipendente di quest\'area: approva il superiore diretto di ciascuno');
  const piani = await pianiDi(membri.map((m) => m.id), b.anno);
  const fatti = [], saltati = [];
  for (const pi of piani) {
    const persona = ctx.perim.persone.get(pi.person_id);
    const c = { piano: pi, persona, proprio: false, gestisce: true, azioni: azioniPiano(pi.stato, { proprio: false, gestisce: true }) };
    try {
      if (azione === 'approva') {
        if (!['PROPOSTO', 'IN_REVISIONE'].includes(pi.stato)) { if (pi.stato === 'BOZZA') saltati.push({ persona: persona.nome, motivo: 'piano non ancora inviato' }); continue; }
        await approvaPiano(ctx, c, b.nota);
      } else {
        if (pi.stato !== 'APPROVATO') continue;
        await definitivoPiano(ctx, c, b.nota);
      }
      fatti.push(persona.nome);
    } catch (e) { saltati.push({ persona: persona.nome, motivo: e.message }); }
  }
  await audit(req, azione === 'approva' ? 'FERIE_AREA_APPROVATA' : 'FERIE_AREA_DEFINITIVA', { module: KEY, entity: 'area', entityId: b.gruppo, label: `${nomeGruppo(b.gruppo, ctx.perim.siti)} ${b.anno}: ${fatti.length} piani`, data: { fatti, saltati } });
  res.json({ fatti, saltati });
}
r.post('/area/approva', ah((req, res) => inBlocco(req, res, 'approva')));
r.post('/area/definitivi', ah((req, res) => inBlocco(req, res, 'definitivo')));

// ---------------------------------------------------------------- variazioni al piano approvato
const varSchema = z.object({
  tipo: z.enum(['AGGIUNTA', 'SPOSTAMENTO', 'RIMOZIONE']),
  periodo_id: z.coerce.number().int().positive().optional().nullable(),
  tipo_periodo: z.enum(['FERIE', 'ROL']).optional().default('FERIE'),
  data_inizio: data.optional(), data_fine: data.optional(),
  mezza_inizio: z.boolean().optional().default(false), mezza_fine: z.boolean().optional().default(false),
  ore: z.coerce.number().positive().max(24).optional().nullable(),
  note: z.string().trim().max(1000).optional().default(''),
});
r.post('/piani/:id/variazioni', ah(async (req, res) => {
  const ctx = await userContext(req);
  const c = await caricaPiano(ctx, req.params.id);
  const b = parse(varSchema, req.body || {});
  const rol = b.tipo === 'AGGIUNTA' && b.tipo_periodo === 'ROL';
  if (!c.proprio) throw forbidden('Le variazioni le propone il dipendente; il responsabile modifica direttamente il piano');
  if (!rol && !c.azioni.variazione) throw bad(c.gestisce ? 'Puoi modificare direttamente il piano' : 'Il piano non è ancora approvato: modifica direttamente i periodi');
  const g = oggi();
  let row, testo;
  if (b.tipo === 'AGGIUNTA') {
    if (!b.data_inizio || !b.data_fine) throw bad('Indica il periodo');
    if (b.data_inizio < g) throw bad('Non puoi chiedere giorni già passati: li registra il responsabile');
    if (Number(b.data_inizio.slice(0, 4)) !== c.piano.anno) throw bad(`La variazione deve stare nell'anno del piano (${c.piano.anno})`);
    const a = await analizza(ctx, c.persona, { ...b, tipo: b.tipo_periodo });
    if (a.conflitti.length) throw bad(testoConflitti(a.conflitti));
    const cop = await coperturaRichiesta(ctx.perim, { id: null, tipo: b.tipo_periodo, ...b }, c.persona, a.dettaglio, ctx.settings);
    row = await tx(async (cl) => {
      const x = (await cl.query(`INSERT INTO richieste (person_id, anno, tipo, data_inizio, data_fine, mezza_inizio, mezza_fine, giorni, ore, note, stato, gruppo, approvatore_person_id, inserita_da_user_id,
          sotto_copertura, copertura, piano_id, variazione) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'RICHIESTA',$11,$12,$13,$14,$15,$16,TRUE) RETURNING *`,
      [c.persona.id, c.piano.anno, b.tipo_periodo, b.data_inizio, rol ? b.data_inizio : b.data_fine, rol ? false : b.mezza_inizio, rol ? false : b.mezza_fine, a.giorni, a.ore, b.note,
        c.persona.gruppo, c.persona.approvatore_id || null, ctx.uid, cop.length > 0, JSON.stringify(cop), c.piano.id])).rows[0];
      await evento(x.id, 'RICHIESTA', ctx.uid, { giorni: a.giorni, ore: a.ore, variazione: 'AGGIUNTA', sotto_copertura: cop.length || undefined }, cl);
      await eventoPiano(c.piano.id, 'VARIAZIONE_PROPOSTA', ctx.uid, { tipo: 'AGGIUNTA', periodo_id: x.id, dal: x.data_inizio, al: x.data_fine, giorni: a.giorni, ore: a.ore, note: b.note || undefined }, cl);
      return x;
    });
    testo = rol ? `permesso ROL di ${b.ore} ore il ${row.data_inizio.split('-').reverse().join('/')}` : `aggiunta del periodo ${descriviPeriodo(row)}`;
  } else {
    if (!b.periodo_id) throw bad('Indica il periodo da spostare o togliere');
    const x = await periodoDelPiano(c, b.periodo_id);
    if (x.data_inizio <= g) throw bad('Il periodo è già iniziato: chiedi al responsabile di modificarlo');
    if (x.variazione_proposta) throw bad('Per questo periodo c\'è già una variazione in attesa');
    let proposta = { tipo: 'RIMOZIONE', note: b.note, user_id: ctx.uid, at: new Date().toISOString() };
    if (b.tipo === 'SPOSTAMENTO') {
      if (!b.data_inizio || !b.data_fine) throw bad('Indica le nuove date');
      if (b.data_inizio < g) throw bad('Non puoi spostare su giorni già passati');
      if (Number(b.data_inizio.slice(0, 4)) !== c.piano.anno) throw bad(`Le nuove date devono stare nell'anno del piano (${c.piano.anno})`);
      const a = await analizza(ctx, c.persona, { ...b, tipo: 'FERIE' }, x.id);
      if (a.conflitti.length) throw bad(testoConflitti(a.conflitti));
      proposta = { ...proposta, tipo: 'SPOSTAMENTO', data_inizio: b.data_inizio, data_fine: b.data_fine, mezza_inizio: b.mezza_inizio, mezza_fine: b.mezza_fine, giorni: a.giorni };
    }
    await tx(async (cl) => {
      await cl.query('UPDATE richieste SET variazione_proposta=$2, updated_at=now() WHERE id=$1', [x.id, JSON.stringify(proposta)]);
      await evento(x.id, 'VARIAZIONE_PROPOSTA', ctx.uid, proposta, cl);
      await eventoPiano(c.piano.id, 'VARIAZIONE_PROPOSTA', ctx.uid, { ...proposta, user_id: undefined, at: undefined, periodo_id: x.id, prima: { dal: x.data_inizio, al: x.data_fine } }, cl);
    });
    row = await one('SELECT * FROM richieste WHERE id=$1', [x.id]);
    testo = b.tipo === 'RIMOZIONE' ? `togliere il periodo ${descriviPeriodo(x)}` : `spostare ${descriviPeriodo(x)} al ${proposta.data_inizio.split('-').reverse().join('/')} → ${proposta.data_fine.split('-').reverse().join('/')}`;
  }
  await audit(req, 'FERIE_VARIAZIONE_PROPOSTA', { module: KEY, entity: 'piano', entityId: c.piano.id, label: `${c.persona.nome} ${c.piano.anno}: ${testo}`, data: { tipo: b.tipo, periodo_id: row.id } });
  // Chi non ha nessuno sopra (il vertice): la variazione entra subito nel piano, "senza approvatore in organigramma"
  if (c.persona.vertice) {
    const x = await one('SELECT * FROM richieste WHERE id=$1', [row.id]);
    const t = await applicaVariazione(ctx, { x, persona: c.persona, piano: c.piano }, '', { automatica: true });
    await audit(req, 'FERIE_VARIAZIONE_APPROVATA', { module: KEY, entity: 'piano', entityId: c.piano.id, label: `${c.persona.nome} ${c.piano.anno}: ${t} (${NOTA_SENZA_APPROVATORE})`, data: { periodo_id: row.id, senza_approvatore: true } });
    return res.status(201).json({ ...(await one('SELECT * FROM richieste WHERE id=$1', [row.id])), avviso: `Variazione applicata: ${NOTA_SENZA_APPROVATORE}.` });
  }
  await avvisaResponsabile(c.persona, c.piano, { evento: 'variazione', title: `${c.persona.nome} propone una variazione al piano ferie ${c.piano.anno}`, body: `${testo}${b.note ? ` · ${b.note}` : ''}`, exclude: [ctx.uid] });
  res.status(201).json(row);
}));

/** Variazione da decidere: riga RICHIESTA (aggiunta o permesso) o periodo con variazione_proposta (spostamento, rimozione) */
async function caricaVariazione(ctx, rid) {
  const x = await one('SELECT * FROM richieste WHERE id=$1', [Number(rid)]);
  if (!x) throw notFound('Variazione non trovata');
  if (!(x.stato === 'RICHIESTA' || (x.variazione_proposta && ['APPROVATA', 'PIANIFICATA'].includes(x.stato)))) throw bad('Nessuna variazione in attesa su questo periodo');
  const persona = ctx.perim.persone.get(x.person_id);
  const proprio = x.person_id === ctx.personId;
  if (!(proprio || ctx.puoDecidere(x.person_id) || ctx.tutto)) throw forbidden('Variazione di un\'altra persona');
  if (!persona) throw bad('Persona fuori dal perimetro del Piano Ferie');
  if (!x.piano_id) { await assicuraPiani([x.person_id], x.anno); x.piano_id = (await pianiDi([x.person_id], x.anno))[0]?.id || null; if (x.piano_id) await q('UPDATE richieste SET piano_id=$2 WHERE id=$1', [x.id, x.piano_id]); }
  const piano = x.piano_id ? await loadPiano(x.piano_id) : { id: null, anno: x.anno };
  return { x, persona, piano, proprio };
}

/**
 * Applica una variazione in attesa (approvazione del responsabile, o automatica per chi non ha nessuno sopra): l'aggiunta diventa periodo
 * approvato, lo spostamento cambia le date, la rimozione toglie il periodo; il piano sale di versione. Ritorna il testo della variazione.
 */
async function applicaVariazione(ctx, { x, persona, piano }, nota, { automatica = false } = {}) {
  const g = oggi();
  const extra = automatica ? { senza_approvatore: true, nota: NOTA_SENZA_APPROVATORE } : { nota: nota || undefined };
  const notaDec = automatica ? NOTA_SENZA_APPROVATORE : nota;
  let testo;
  await tx(async (cl) => {
    if (x.stato === 'RICHIESTA') {
      const stato = x.data_fine < g ? 'GODUTA' : 'APPROVATA';
      const u = await cl.query(`UPDATE richieste SET stato=$2, deciso_da_user_id=$3, deciso_at=now(), nota_decisione=nullif($4,''), goduta_at=CASE WHEN $2='GODUTA' THEN now() END, updated_at=now() WHERE id=$1 AND stato='RICHIESTA'`, [x.id, stato, automatica ? null : ctx.uid, notaDec]);
      if (!u.rowCount) throw bad('La variazione è stata decisa da un altro nel frattempo');
      await evento(x.id, 'APPROVATA', ctx.uid, { variazione: true, ...extra }, cl);
      testo = x.tipo === 'ROL' ? `permesso ROL del ${x.data_inizio.split('-').reverse().join('/')}` : `aggiunta di ${descriviPeriodo(x)}`;
    } else {
      const v = x.variazione_proposta;
      if (v.tipo === 'RIMOZIONE') {
        await cl.query(`UPDATE richieste SET stato='ANNULLATA', annullata_da_user_id=$2, annullata_at=now(), variazione_proposta=NULL, nota_decisione=nullif($3,''), updated_at=now() WHERE id=$1`, [x.id, ctx.uid, notaDec]);
        testo = `rimozione di ${descriviPeriodo(x)}`;
      } else {
        const a = await analizza(ctx, persona, { tipo: 'FERIE', data_inizio: v.data_inizio, data_fine: v.data_fine, mezza_inizio: v.mezza_inizio, mezza_fine: v.mezza_fine }, x.id);
        if (a.conflitti.length) throw bad(testoConflitti(a.conflitti));
        const cop = await coperturaRichiesta(ctx.perim, { ...x, data_inizio: v.data_inizio, data_fine: v.data_fine, mezza_inizio: v.mezza_inizio, mezza_fine: v.mezza_fine }, persona, a.dettaglio, ctx.settings);
        await cl.query(`UPDATE richieste SET data_inizio=$2, data_fine=$3, mezza_inizio=$4, mezza_fine=$5, giorni=$6, variazione_proposta=NULL, sotto_copertura=$7, copertura=$8,
            deciso_da_user_id=$9, deciso_at=now(), nota_decisione=nullif($10,''), modificata_da_user_id=$11, modificata_at=now(), updated_at=now() WHERE id=$1`,
        [x.id, v.data_inizio, v.data_fine, Boolean(v.mezza_inizio), Boolean(v.mezza_fine), a.giorni, cop.length > 0, JSON.stringify(cop), automatica ? null : ctx.uid, notaDec, ctx.uid]);
        testo = `spostamento di ${descriviPeriodo(x)} al ${v.data_inizio.split('-').reverse().join('/')} → ${v.data_fine.split('-').reverse().join('/')}`;
      }
      await evento(x.id, 'VARIAZIONE_APPROVATA', ctx.uid, { tipo: v.tipo, ...extra }, cl);
    }
    if (piano.id) {
      await cl.query('UPDATE piani SET versione = versione + 1, updated_at=now() WHERE id=$1', [piano.id]);
      await eventoPiano(piano.id, 'VARIAZIONE_APPROVATA', ctx.uid, { periodo_id: x.id, testo, ...extra }, cl);
    }
  });
  return testo;
}

r.post('/variazioni/:rid/approva', ah(async (req, res) => {
  const ctx = await userContext(req);
  const { x, persona, piano } = await caricaVariazione(ctx, req.params.rid);
  if (!ctx.puoDecidere(x.person_id)) throw forbidden(`La variazione la decide ${persona.approvatore_nome || 'l\'amministratore'} (superiore diretto in anagrafica)`);
  const b = parse(notaSchema, req.body || {});
  const testo = await applicaVariazione(ctx, { x, persona, piano }, b.nota);
  await audit(req, 'FERIE_VARIAZIONE_APPROVATA', { module: KEY, entity: 'piano', entityId: piano.id, label: `${persona.nome} ${x.anno}: ${testo}`, data: { periodo_id: x.id } });
  if (piano.id) await avvisaDipendente(persona, piano, { evento: 'variazione_approvata', title: `Variazione al piano ferie ${x.anno} approvata`, body: `${testo}${b.nota ? ` · ${b.nota}` : ''}`, exclude: [ctx.uid] });
  res.json(await one('SELECT * FROM richieste WHERE id=$1', [x.id]));
}));

r.post('/variazioni/:rid/rifiuta', ah(async (req, res) => {
  const ctx = await userContext(req);
  const { x, persona, piano } = await caricaVariazione(ctx, req.params.rid);
  if (!ctx.puoDecidere(x.person_id)) throw forbidden(`La variazione la decide ${persona.approvatore_nome || 'l\'amministratore'} (superiore diretto in anagrafica)`);
  const b = parse(z.object({ nota: z.string().trim().min(3, 'Scrivi il motivo (lo legge il dipendente)').max(1000) }), req.body || {});
  let testo;
  await tx(async (cl) => {
    if (x.stato === 'RICHIESTA') {
      const u = await cl.query(`UPDATE richieste SET stato='RIFIUTATA', deciso_da_user_id=$2, deciso_at=now(), nota_decisione=$3, updated_at=now() WHERE id=$1 AND stato='RICHIESTA'`, [x.id, ctx.uid, b.nota]);
      if (!u.rowCount) throw bad('La variazione è stata decisa da un altro nel frattempo');
      await evento(x.id, 'RIFIUTATA', ctx.uid, { variazione: true, nota: b.nota }, cl);
      testo = `aggiunta di ${descriviPeriodo(x)}`;
    } else {
      await cl.query('UPDATE richieste SET variazione_proposta=NULL, updated_at=now() WHERE id=$1', [x.id]);
      await evento(x.id, 'VARIAZIONE_RIFIUTATA', ctx.uid, { tipo: x.variazione_proposta.tipo, nota: b.nota }, cl);
      testo = `${x.variazione_proposta.tipo === 'RIMOZIONE' ? 'rimozione' : 'spostamento'} di ${descriviPeriodo(x)}`;
    }
    if (piano.id) await eventoPiano(piano.id, 'VARIAZIONE_RIFIUTATA', ctx.uid, { periodo_id: x.id, testo, nota: b.nota }, cl);
  });
  await audit(req, 'FERIE_VARIAZIONE_RIFIUTATA', { module: KEY, entity: 'piano', entityId: piano.id, label: `${persona.nome} ${x.anno}: ${testo}`, data: { periodo_id: x.id, nota: b.nota } });
  if (piano.id) await avvisaDipendente(persona, piano, { evento: 'variazione_rifiutata', title: `Variazione al piano ferie ${x.anno} non accolta`, body: `${testo} · ${b.nota}`, exclude: [ctx.uid] });
  res.json(await one('SELECT * FROM richieste WHERE id=$1', [x.id]));
}));

// Il dipendente ritira una propria variazione non ancora decisa
r.post('/variazioni/:rid/ritira', ah(async (req, res) => {
  const ctx = await userContext(req);
  const { x, piano, proprio } = await caricaVariazione(ctx, req.params.rid);
  if (!proprio) throw forbidden('Ritira la variazione solo chi l\'ha proposta');
  await tx(async (cl) => {
    if (x.stato === 'RICHIESTA') await cl.query(`UPDATE richieste SET stato='ANNULLATA', annullata_da_user_id=$2, annullata_at=now(), updated_at=now() WHERE id=$1 AND stato='RICHIESTA'`, [x.id, ctx.uid]);
    else await cl.query('UPDATE richieste SET variazione_proposta=NULL, updated_at=now() WHERE id=$1', [x.id]);
    await evento(x.id, 'ANNULLATA', ctx.uid, { variazione_ritirata: true }, cl);
    if (piano.id) await eventoPiano(piano.id, 'VARIAZIONE_RIFIUTATA', ctx.uid, { periodo_id: x.id, ritirata: true }, cl);
  });
  res.json({ ok: true });
}));

export default r;
export { datiArea };
