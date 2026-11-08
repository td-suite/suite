// Richieste di ferie e ROL: il mio saldo, conteggio dei giorni, inserimento, elenco, dettaglio, approvazione, rifiuto, annullamento.
// Stati: RICHIESTA → APPROVATA / RIFIUTATA (approvatore dall'organigramma, delegato o HR) → GODUTA (job a data passata) · ANNULLATA.
import { Router } from 'express';
import { z } from 'zod';
import { q, one, many, tx } from '../db.js';
import { ah, parse, audit, notFound, forbidden, bad } from '../../../lib/util.js';
import {
  KEY, STATO_LABEL, userContext, saldoPersona, calendarioPersona, loadRichiesta, evento, notifica, utentiDiPersone, utentiHr,
  periodoTesto, quantitaTesto, oggi, R_COLS, R_FROM,
} from '../lib/core.js';
import { contaGiorni, isoWeekday } from '../lib/calendario.js';
import { coperturaRichiesta, chiusureGruppo } from '../lib/piano.js';
import { nomeGruppo } from '../lib/perimetro.js';

const r = Router();
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida (AAAA-MM-GG)');
const annoQ = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : Number(oggi().slice(0, 4)); };

const reqSchema = z.object({
  person_id: z.coerce.number().int().positive().optional(),
  tipo: z.enum(['FERIE', 'ROL']).optional().default('FERIE'),
  data_inizio: data, data_fine: data,
  mezza_inizio: z.boolean().optional().default(false), mezza_fine: z.boolean().optional().default(false),
  ore: z.coerce.number().positive().max(24).optional().nullable(),
  note: z.string().trim().max(1000).optional().default(''),
  chiusura_id: z.coerce.number().int().positive().optional().nullable(),
  approva_subito: z.boolean().optional().default(false),
});

/** Persona del perimetro per cui si opera: la propria, oppure (HR) qualunque persona del perimetro */
function personaPer(ctx, personId) {
  const pid = personId || ctx.personId;
  if (!pid) throw bad('Il tuo account non è collegato a una persona dell\'anagrafica: chiedi all\'amministrazione');
  if (pid !== ctx.personId && !ctx.isAdmin) throw forbidden('Solo HR inserisce richieste per conto di altri');
  const p = ctx.perim.persone.get(pid);
  if (!p) throw bad(pid === ctx.personId ? 'Il Piano Ferie riguarda i dipendenti con contratto di lavoro subordinato: il tuo profilo non è nel perimetro' : 'Persona fuori dal perimetro del Piano Ferie (dipendenti attivi con contratto di lavoro)');
  return p;
}

/** Conteggio e controlli di un periodo per una persona (usato dall'anteprima e dall'inserimento) */
async function analizza(ctx, p, b, escludiId = null) {
  if (b.data_inizio.slice(0, 4) !== b.data_fine.slice(0, 4)) throw bad('Il periodo è a cavallo di due anni: dividilo in due richieste (una per anno)');
  const anno = Number(b.data_inizio.slice(0, 4));
  const cal = await calendarioPersona(p, [anno], ctx.settings);
  if (b.tipo === 'ROL') {
    if (!ctx.settings.rol_attivi) throw bad('La voce ROL/permessi non è attiva (Impostazioni del modulo)');
    if (b.data_inizio !== b.data_fine) throw bad('Un permesso ROL si chiede per un solo giorno, in ore');
    if (!b.ore) throw bad('Indica le ore del permesso');
  }
  const c = b.tipo === 'ROL' ? { giorni: 0, dettaglio: [{ data: b.data_inizio, quota: 0 }] } : contaGiorni({ inizio: b.data_inizio, fine: b.data_fine, mezza_inizio: b.mezza_inizio, mezza_fine: b.mezza_fine }, cal);
  if (c.errore) throw bad(c.errore);
  if (b.tipo === 'FERIE' && c.giorni <= 0) throw bad('Nel periodo non ci sono giorni lavorativi (festivi o giorni di riposo della tua settimana lavorativa)');
  if (b.tipo === 'ROL' && !cal.settimana.includes(isoWeekday(b.data_inizio))) throw bad('Il giorno scelto non è lavorativo nella tua settimana');
  const sovrapposte = await many(`SELECT id, tipo, stato, data_inizio, data_fine FROM richieste WHERE person_id=$1 AND stato IN ('RICHIESTA','APPROVATA','GODUTA')
      AND data_fine >= $2 AND data_inizio <= $3 AND ($4::int IS NULL OR id <> $4)`, [p.id, b.data_inizio, b.data_fine, escludiId]);
  // nessuna sovrapposizione con altre richieste attive (ferie o ROL) della stessa persona
  const conflitti = sovrapposte;
  const saldo = await saldoPersona(p, anno, ctx.settings);
  const dopo = b.tipo === 'FERIE' ? Math.round((saldo.disponibile - c.giorni) * 100) / 100 : null;
  const avvisi = [];
  if (dopo != null && dopo < 0) avvisi.push(`Con questa richiesta il saldo disponibile va a ${dopo.toLocaleString('it-IT')} giorni (anticipo di ferie: deciderà l'approvatore)`);
  const fuori = (p.inizio && b.data_inizio < p.inizio) || (p.fine && b.data_fine > p.fine);
  if (fuori) avvisi.push('Il periodo esce dalle date del contratto di lavoro');
  const chiusure = await chiusureGruppo(p.gruppo, b.data_inizio, b.data_fine);
  return { anno, giorni: c.giorni, ore: b.tipo === 'ROL' ? b.ore : null, dettaglio: c.dettaglio, festivi: c.dettaglio.filter((d) => d.festivo), conflitti, saldo, saldo_dopo: dopo, avvisi, chiusure, settimana: cal.settimana_etichetta };
}

// ---------------------------------------------------------------- il mio piano
r.get('/me', ah(async (req, res) => {
  const ctx = await userContext(req);
  const anno = annoQ(req.query.anno);
  const p = ctx.me;
  const base = { anno, settings: { rol_attivi: Boolean(ctx.settings.rol_attivi), avviso_dipendenti: ctx.settings.avviso_dipendenti || '', scadenza_ap: ctx.settings.scadenza_ap }, contratti: ctx.perim.contratti };
  if (!p) {
    const motivo = !ctx.perim.contratti ? 'Il modulo Contratti del personale non è ancora avviato: il perimetro dei dipendenti non è disponibile.'
      : !ctx.personId ? 'Il tuo account non è collegato a una persona dell\'anagrafica.'
      : 'Il Piano Ferie riguarda i dipendenti attivi con contratto di lavoro subordinato in Contratti del personale.';
    return res.json({ ...base, fuori_perimetro: true, motivo });
  }
  const saldo = await saldoPersona(p, anno, ctx.settings);
  const richieste = await many(`SELECT ${R_COLS} FROM ${R_FROM} WHERE r.person_id=$1 AND r.anno=$2 ORDER BY r.data_inizio DESC, r.id DESC`, [p.id, anno]);
  const chiusure = await chiusureGruppo(p.gruppo, oggi(), `${anno + 1}-12-31`);
  const cal = await calendarioPersona(p, [anno], ctx.settings);
  res.json({
    ...base,
    persona: { id: p.id, nome: p.nome, gruppo: p.gruppo, gruppo_nome: nomeGruppo(p.gruppo, ctx.perim.siti), area_origine: p.area_origine, ruolo: p.role_name, approvatore: p.approvatore_nome || null, approvatore_origine: p.approvatore_origine, contratto: p.contratto, inizio: p.inizio, fine: p.fine },
    saldo, richieste, chiusure: chiusure.map((c) => ({ ...c, gia_richiesta: richieste.some((x) => ['RICHIESTA', 'APPROVATA', 'GODUTA'].includes(x.stato) && x.data_inizio <= c.data_fine && x.data_fine >= c.data_inizio) })),
    festivi: [...cal.festivi.entries()].filter(([d]) => d.startsWith(String(anno))).map(([d, n]) => ({ data: d, nome: n })), settimana: cal.settimana_etichetta,
  });
}));

// Anteprima del conteggio (nessuna scrittura)
r.post('/calcola', ah(async (req, res) => {
  const ctx = await userContext(req);
  const b = parse(reqSchema, req.body || {});
  const p = personaPer(ctx, b.person_id);
  const a = await analizza(ctx, p, b);
  res.json({ ...a, saldo: undefined, disponibile: a.saldo.disponibile });
}));

// ---------------------------------------------------------------- inserimento
r.post('/richieste', ah(async (req, res) => {
  const ctx = await userContext(req);
  const b = parse(reqSchema, req.body || {});
  const p = personaPer(ctx, b.person_id);
  const perConto = p.id !== ctx.personId;
  if (!perConto && b.data_inizio < oggi()) throw bad('Non puoi chiedere ferie per giorni già passati: le registra HR');
  if (b.approva_subito && !ctx.isAdmin) throw forbidden('Solo HR registra una richiesta già approvata');
  const a = await analizza(ctx, p, b);
  if (a.conflitti.length) throw bad(`Il periodo si sovrappone a ${a.conflitti.length === 1 ? 'un\'altra richiesta' : `${a.conflitti.length} richieste`} (${a.conflitti.map((x) => `${x.data_inizio} → ${x.data_fine}, ${STATO_LABEL[x.stato]}`).join('; ')})`);
  if (b.chiusura_id && !(await one(`SELECT 1 FROM chiusure WHERE id=$1 AND (gruppo=$2 OR gruppo='TUTTE')`, [b.chiusura_id, p.gruppo]))) throw bad('Chiusura collettiva non valida per la tua area');
  const cop = await coperturaRichiesta(ctx.perim, { ...b, id: null }, p, a.dettaglio, ctx.settings);
  const stato = b.approva_subito ? (b.data_fine < oggi() ? 'GODUTA' : 'APPROVATA') : 'RICHIESTA';
  const row = await tx(async (c) => {
    const x = (await c.query(`INSERT INTO richieste (person_id, anno, tipo, data_inizio, data_fine, mezza_inizio, mezza_fine, giorni, ore, note, stato, gruppo, approvatore_person_id,
        chiusura_id, inserita_da_user_id, sotto_copertura, copertura, deciso_da_user_id, deciso_at, goduta_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) RETURNING id`,
    [p.id, a.anno, b.tipo, b.data_inizio, b.data_fine, b.tipo === 'ROL' ? false : b.mezza_inizio, b.tipo === 'ROL' ? false : b.mezza_fine, a.giorni, a.ore, b.note, stato, p.gruppo, p.approvatore_id || null,
      b.chiusura_id || null, ctx.uid, cop.length > 0, JSON.stringify(cop), stato !== 'RICHIESTA' ? ctx.uid : null, stato !== 'RICHIESTA' ? new Date() : null, stato === 'GODUTA' ? new Date() : null])).rows[0];
    await evento(x.id, 'RICHIESTA', ctx.uid, { giorni: a.giorni, ore: a.ore, per_conto: perConto || undefined, sotto_copertura: cop.length || undefined }, c);
    if (stato !== 'RICHIESTA') await evento(x.id, 'APPROVATA', ctx.uid, { registrata_da_hr: true }, c);
    return x;
  });
  const rr = await loadRichiesta(row.id);
  await audit(req, 'FERIE_RICHIESTA', { module: KEY, entity: 'richiesta', entityId: rr.id, label: `${rr.persona} · ${periodoTesto(rr)}`, data: { giorni: rr.giorni, ore: rr.ore, stato } });
  if (stato === 'RICHIESTA') {
    // all'approvatore (e ai suoi delegati in questo momento); senza approvatore, a HR
    const delegati = p.approvatore_id ? (await many(`SELECT delegato_person_id AS id FROM deleghe WHERE delegante_person_id=$1 AND $2::date BETWEEN dal AND al`, [p.approvatore_id, oggi()])).map((x) => x.id) : [];
    let dest = await utentiDiPersone([p.approvatore_id, ...delegati]);
    if (!dest.length) dest = await utentiHr();
    await notifica(dest, rr, { evento: 'richiesta', title: `${rr.persona}: richiesta di ${quantitaTesto(rr)}`, body: `${periodoTesto(rr)}${cop.length ? ` · attenzione: ${cop.length} ${cop.length === 1 ? 'giorno' : 'giorni'} sotto la copertura minima` : ''}${rr.note ? ` · ${rr.note}` : ''}`, exclude: [ctx.uid] });
  } else if (perConto) {
    await notifica(await utentiDiPersone([p.id]), rr, { evento: 'registrata', title: `Ferie registrate da HR: ${quantitaTesto(rr)}`, body: periodoTesto(rr), exclude: [ctx.uid] });
  }
  res.status(201).json({ ...rr, avvisi: a.avvisi });
}));

// ---------------------------------------------------------------- elenco
r.get('/richieste', ah(async (req, res) => {
  const ctx = await userContext(req);
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };
  const where = [];
  const vista = String(req.query.vista || 'mie');
  if (vista === 'mie') where.push(`r.person_id = ${p(ctx.personId || 0)}`);
  else if (vista === 'da_approvare') {
    where.push(`r.stato = 'RICHIESTA'`);
    if (!ctx.isAdmin) where.push(`r.person_id = ANY(${p([...ctx.approva])}::int[])`);
    else if (req.query.solo_mie === '1') where.push(`r.person_id = ANY(${p([...ctx.approva])}::int[])`);
  } else {
    // tutte quelle visibili: HR e consultazione tutto; responsabili le proprie e quelle della loro area; dipendenti le proprie
    if (!ctx.tutto) where.push(`(r.person_id = ${p(ctx.personId || 0)} OR r.person_id = ANY(${p([...ctx.approva])}::int[]))`);
  }
  if (req.query.anno) where.push(`r.anno = ${p(annoQ(req.query.anno))}`);
  if (req.query.stato && STATO_LABEL[req.query.stato]) where.push(`r.stato = ${p(req.query.stato)}`);
  if (req.query.tipo && ['FERIE', 'ROL'].includes(req.query.tipo)) where.push(`r.tipo = ${p(req.query.tipo)}`);
  if (req.query.gruppo) where.push(`r.gruppo = ${p(String(req.query.gruppo))}`);
  if (req.query.person_id) where.push(`r.person_id = ${p(Number(req.query.person_id) || 0)}`);
  if (req.query.sotto_copertura === '1') where.push('r.sotto_copertura');
  if (req.query.q) where.push(`(lower(p.last_name || ' ' || p.first_name) LIKE ${p(`%${String(req.query.q).toLowerCase()}%`)} OR lower(r.note) LIKE $${params.length})`);
  const sql = `FROM ${R_FROM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const page = Math.max(1, Number(req.query.page) || 1), pageSize = Math.min(200, Math.max(5, Number(req.query.pageSize) || 50));
  const total = (await one(`SELECT count(*)::int AS n ${sql}`, params)).n;
  const rows = await many(`SELECT ${R_COLS} ${sql} ORDER BY ${vista === 'da_approvare' ? 'r.data_inizio ASC' : 'r.data_inizio DESC'}, r.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params);
  res.json({ rows: rows.map((x) => ({ ...x, gruppo_nome: nomeGruppo(x.gruppo, ctx.perim.siti), puo_decidere: x.stato === 'RICHIESTA' && ctx.puoDecidere(x.person_id) })), total, page, pageSize });
}));

// ---------------------------------------------------------------- dettaglio
async function caricaVisibile(ctx, id) {
  const x = await loadRichiesta(Number(id));
  if (!x) throw notFound('Richiesta non trovata');
  if (!(ctx.tutto || x.person_id === ctx.personId || ctx.approva.has(x.person_id))) throw forbidden('Richiesta di un\'altra persona');
  return x;
}
r.get('/richieste/:id', ah(async (req, res) => {
  const ctx = await userContext(req);
  const x = await caricaVisibile(ctx, req.params.id);
  const eventi = await many(`SELECT e.*, u.full_name AS user_nome FROM eventi e LEFT JOIN public.users u ON u.id=e.user_id WHERE e.richiesta_id=$1 ORDER BY e.created_at, e.id`, [x.id]);
  const p = ctx.perim.persone.get(x.person_id);
  const decide = x.stato === 'RICHIESTA' && ctx.puoDecidere(x.person_id);
  let copertura = x.copertura || [];
  // la copertura si ricalcola per chi decide: nel frattempo altre richieste possono essere state approvate o annullate
  if (decide && p && x.tipo === 'FERIE') {
    const cal = await calendarioPersona(p, [x.anno], ctx.settings);
    const c = contaGiorni({ inizio: x.data_inizio, fine: x.data_fine, mezza_inizio: x.mezza_inizio, mezza_fine: x.mezza_fine }, cal);
    copertura = await coperturaRichiesta(ctx.perim, x, p, c.dettaglio, ctx.settings);
  }
  const saldo = p && ctx.vedeSaldo(x.person_id) ? await saldoPersona(p, x.anno, ctx.settings) : null;
  const mia = x.person_id === ctx.personId;
  res.json({
    ...x, eventi, copertura, gruppo_nome: nomeGruppo(x.gruppo, ctx.perim.siti), saldo,
    azioni: {
      approva: decide, rifiuta: decide,
      annulla: (mia && (x.stato === 'RICHIESTA' || (x.stato === 'APPROVATA' && x.data_inizio > oggi()))) || (ctx.puoDecidere(x.person_id) && ['RICHIESTA', 'APPROVATA'].includes(x.stato)) || (ctx.isAdmin && x.stato === 'GODUTA'),
    },
  });
}));

// ---------------------------------------------------------------- decisioni
const notaSchema = z.object({ nota: z.string().trim().max(1000).optional().default('') });
r.post('/richieste/:id/approva', ah(async (req, res) => {
  const ctx = await userContext(req);
  const b = parse(notaSchema, req.body || {});
  const x = await caricaVisibile(ctx, req.params.id);
  if (!ctx.puoDecidere(x.person_id)) throw forbidden('Non sei l\'approvatore di questa persona');
  if (x.stato !== 'RICHIESTA') throw bad(`La richiesta è già ${STATO_LABEL[x.stato].toLowerCase()}`);
  const p = ctx.perim.persone.get(x.person_id);
  let cop = x.copertura || [];
  if (p && x.tipo === 'FERIE') {
    const cal = await calendarioPersona(p, [x.anno], ctx.settings);
    cop = await coperturaRichiesta(ctx.perim, x, p, contaGiorni({ inizio: x.data_inizio, fine: x.data_fine, mezza_inizio: x.mezza_inizio, mezza_fine: x.mezza_fine }, cal).dettaglio, ctx.settings);
  }
  const stato = x.data_fine < oggi() ? 'GODUTA' : 'APPROVATA';
  const upd = await q(`UPDATE richieste SET stato=$2, deciso_da_user_id=$3, deciso_at=now(), nota_decisione=$4, sotto_copertura=$5, copertura=$6, goduta_at=CASE WHEN $2='GODUTA' THEN now() END, updated_at=now() WHERE id=$1 AND stato='RICHIESTA'`,
    [x.id, stato, ctx.uid, b.nota || null, cop.length > 0, JSON.stringify(cop)]);
  if (!upd.rowCount) throw bad('La richiesta è stata decisa da un altro nel frattempo');
  await evento(x.id, 'APPROVATA', ctx.uid, { nota: b.nota || undefined, sotto_copertura: cop.length || undefined, hr: ctx.isAdmin && !ctx.approva.has(x.person_id) ? true : undefined });
  if (stato === 'GODUTA') await evento(x.id, 'GODUTA', null, { automatico: true });
  const rr = await loadRichiesta(x.id);
  await audit(req, 'FERIE_APPROVATA', { module: KEY, entity: 'richiesta', entityId: x.id, label: `${rr.persona} · ${periodoTesto(rr)}`, data: { sotto_copertura: cop.length } });
  await notifica(await utentiDiPersone([x.person_id]), rr, { evento: 'approvata', title: `Ferie approvate: ${periodoTesto(rr)}`, body: `${quantitaTesto(rr)}${b.nota ? ` · ${b.nota}` : ''}`, exclude: [ctx.uid] });
  res.json(rr);
}));

r.post('/richieste/:id/rifiuta', ah(async (req, res) => {
  const ctx = await userContext(req);
  const b = parse(z.object({ nota: z.string().trim().min(3, 'Scrivi il motivo del rifiuto').max(1000) }), req.body || {});
  const x = await caricaVisibile(ctx, req.params.id);
  if (!ctx.puoDecidere(x.person_id)) throw forbidden('Non sei l\'approvatore di questa persona');
  if (x.stato !== 'RICHIESTA') throw bad(`La richiesta è già ${STATO_LABEL[x.stato].toLowerCase()}`);
  const upd = await q(`UPDATE richieste SET stato='RIFIUTATA', deciso_da_user_id=$2, deciso_at=now(), nota_decisione=$3, updated_at=now() WHERE id=$1 AND stato='RICHIESTA'`, [x.id, ctx.uid, b.nota]);
  if (!upd.rowCount) throw bad('La richiesta è stata decisa da un altro nel frattempo');
  await evento(x.id, 'RIFIUTATA', ctx.uid, { nota: b.nota });
  const rr = await loadRichiesta(x.id);
  await audit(req, 'FERIE_RIFIUTATA', { module: KEY, entity: 'richiesta', entityId: x.id, label: `${rr.persona} · ${periodoTesto(rr)}` });
  await notifica(await utentiDiPersone([x.person_id]), rr, { evento: 'rifiutata', title: `Ferie non approvate: ${periodoTesto(rr)}`, body: b.nota, exclude: [ctx.uid] });
  res.json(rr);
}));

r.post('/richieste/:id/annulla', ah(async (req, res) => {
  const ctx = await userContext(req);
  const b = parse(z.object({ motivo: z.string().trim().max(1000).optional().default('') }), req.body || {});
  const x = await caricaVisibile(ctx, req.params.id);
  const mia = x.person_id === ctx.personId;
  const ok = (mia && (x.stato === 'RICHIESTA' || (x.stato === 'APPROVATA' && x.data_inizio > oggi()))) || (ctx.puoDecidere(x.person_id) && ['RICHIESTA', 'APPROVATA'].includes(x.stato)) || (ctx.isAdmin && x.stato === 'GODUTA');
  if (!ok) throw forbidden(mia && x.stato === 'APPROVATA' ? 'Le ferie già iniziate le annulla solo HR o l\'approvatore' : 'Annullamento non consentito');
  await q(`UPDATE richieste SET stato='ANNULLATA', annullata_da_user_id=$2, annullata_at=now(), nota_decisione=coalesce(nullif($3,''), nota_decisione), updated_at=now() WHERE id=$1`, [x.id, ctx.uid, b.motivo]);
  await evento(x.id, 'ANNULLATA', ctx.uid, { motivo: b.motivo || undefined, da_stato: x.stato });
  const rr = await loadRichiesta(x.id);
  await audit(req, 'FERIE_ANNULLATA', { module: KEY, entity: 'richiesta', entityId: x.id, label: `${rr.persona} · ${periodoTesto(rr)}`, data: { da_stato: x.stato } });
  // avvisa l'altra parte: se annulla il dipendente, l'approvatore (solo se era già approvata o in attesa); altrimenti il dipendente
  if (mia) { const dest = await utentiDiPersone([x.approvatore_person_id]); await notifica(dest, rr, { evento: 'annullata', title: `${rr.persona} ha annullato: ${periodoTesto(rr)}`, body: b.motivo || null, exclude: [ctx.uid] }); }
  else await notifica(await utentiDiPersone([x.person_id]), rr, { evento: 'annullata', title: `Ferie annullate: ${periodoTesto(rr)}`, body: b.motivo || null, exclude: [ctx.uid] });
  res.json(rr);
}));

export default r;
export { annoQ };
