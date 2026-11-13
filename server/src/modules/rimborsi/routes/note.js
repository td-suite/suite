// Rimborso Spese · le mie note: elenco per anno, una nota per mese, scheda, dati generali, righe Spese (MOD025) e Chilometri (MOD029),
// "Nuova spesa" pensata per il telefono (foto e tre campi), veicoli propri con la tariffa ACI, Legal entity per cliente o progetto.
// Le modifiche le fa SOLO il dipendente sulla propria nota in BOZZA: dopo l'invio nulla cambia se non tramite respingimento.
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { q, one, many, tx } from '../db.js';
import { ah, bad, forbidden, notFound, parse, audit } from '../../../lib/util.js';
import { config } from '../config.js';
import { KEY, userContext, notaVisibile, caricaNota, ricalcola, evento, benefitPersona, oggi, categorieMap, haEccezione } from '../lib/core.js';
import { controllaData, importoViaggio, nomeMese, primoGiorno, STATO_LABEL } from '../lib/calcoli.js';
import { scheda } from '../lib/scheda.js';
import { salvaAllegato } from './allegati.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxFileBytes, files: 6 } });
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const opt = (s) => z.preprocess((v) => (v === '' || v === 'null' ? null : v), s.optional().nullable());
const importo = () => z.preprocess((v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v), z.number().positive('importo maggiore di zero').max(100000));

/** Persona del contesto (dipendente nel perimetro) o 403 */
const io = (ctx) => { if (!ctx.me) throw forbidden('Il Rimborso Spese è riservato ai dipendenti'); return ctx.me; };
/** Nota propria in BOZZA (modificabile) */
async function miaBozza(ctx, id) {
  const n = await notaVisibile(ctx, id);
  if (n.person_id !== ctx.personId) throw forbidden('Solo il dipendente modifica la propria nota');
  if (n.stato !== 'BOZZA') throw bad(`La nota è ${STATO_LABEL[n.stato].toLowerCase()}: dopo l'invio si modifica solo se il responsabile la respinge`);
  return n;
}

/** Nota del mese (creata se manca). Mai mesi futuri; un mese già liquidato o archiviato è bloccato. */
export async function notaDelMese(ctx, anno, mese, { crea = true } = {}) {
  const g = oggi();
  if (primoGiorno(anno, mese) > g) throw bad('Non si crea la nota di un mese futuro');
  let n = await one('SELECT * FROM note WHERE person_id=$1 AND anno=$2 AND mese=$3', [ctx.personId, anno, mese]);
  if (!n && crea) {
    n = await one(`INSERT INTO note (person_id, anno, mese) VALUES ($1,$2,$3) ON CONFLICT (person_id, anno, mese) DO UPDATE SET updated_at = note.updated_at RETURNING *, (xmax = 0) AS inserita`, [ctx.personId, anno, mese]);
    if (n?.inserita) await evento(n.id, 'CREATA', { userId: ctx.uid, personId: ctx.personId });
  }
  return n;
}

// ---------------------------------------------------------------- elenco e creazione
r.get('/mie-note', ah(async (req, res) => {
  const ctx = await userContext(req);
  const me = io(ctx);
  const g = oggi();
  const anno = Number(req.query.anno) || Number(g.slice(0, 4));
  const note = await many(`SELECT n.id, n.anno, n.mese, n.stato, n.tot_rimborsabile, n.tot_carta, n.saldo, n.anticipi, n.inviata_at, n.in_ritardo, n.liquidata_at, n.liquidazione_data, n.liquidazione_importo,
        (SELECT count(*)::int FROM spese s WHERE s.nota_id = n.id) AS n_spese, (SELECT count(*)::int FROM viaggi v WHERE v.nota_id = n.id) AS n_viaggi,
        r.last_name || ' ' || r.first_name AS responsabile_nome
      FROM note n LEFT JOIN public.people r ON r.id = n.responsabile_person_id WHERE n.person_id=$1 AND n.anno=$2 ORDER BY n.mese DESC`, [me.id, anno]);
  const anni = (await many('SELECT DISTINCT anno FROM note WHERE person_id=$1 ORDER BY anno DESC', [me.id])).map((x) => x.anno);
  const corrente = { anno: Number(g.slice(0, 4)), mese: Number(g.slice(5, 7)) };
  const nc = await one('SELECT id, stato FROM note WHERE person_id=$1 AND anno=$2 AND mese=$3', [me.id, corrente.anno, corrente.mese]);
  const benefit = await benefitPersona(me.id, { pieno: true });
  res.json({
    persona: { id: me.id, nome: me.nome, approvatore: me.approvatore_nome, al_pc: me.al_pc, origine: me.origine },
    anno, anni: [...new Set([corrente.anno, ...anni])].sort((a, b) => b - a), note: note.map((n) => ({ ...n, stato_label: STATO_LABEL[n.stato], titolo: nomeMese(n.anno, n.mese) })),
    corrente: { ...corrente, titolo: nomeMese(corrente.anno, corrente.mese), nota: nc },
    vetture: benefit.vetture.filter((v) => v.in_corso), fuel_card: benefit.fuel_card.filter((f) => f.in_corso),
    avviso: ctx.settings.avviso_dipendenti || '', eccezione: await haEccezione(me.id),
  });
}));

r.post('/note', ah(async (req, res) => {
  const ctx = await userContext(req);
  io(ctx);
  const b = parse(z.object({ anno: z.coerce.number().int().min(2020).max(2100), mese: z.coerce.number().int().min(1).max(12) }), req.body || {});
  const n = await notaDelMese(ctx, b.anno, b.mese);
  res.status(201).json({ id: n.id, stato: n.stato });
}));

r.get('/note/:id', ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await notaVisibile(ctx, req.params.id);
  res.json(await scheda(n, ctx));
}));

r.put('/note/:id', ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await miaBozza(ctx, req.params.id);
  const b = parse(z.object({ motivazione: opt(z.string().trim().max(1000)), anticipi: z.preprocess((v) => (v === '' || v == null ? 0 : typeof v === 'string' ? Number(v.replace(',', '.')) : v), z.number().min(0).max(100000)).optional(), note: opt(z.string().trim().max(2000)) }), req.body || {});
  const campi = ['motivazione', 'anticipi', 'note'].filter((k) => b[k] !== undefined);
  if (campi.length) await q(`UPDATE note SET ${campi.map((k, i) => `${k}=$${i + 2}`).join(', ')}, updated_at=now() WHERE id=$1`, [n.id, ...campi.map((k) => (k === 'anticipi' ? b[k] : b[k] || null))]);
  await ricalcola(n.id);
  res.json(await scheda(await caricaNota(n.id), ctx));
}));

// ---------------------------------------------------------------- righe: Spese
const spesaSchema = z.object({
  data: z.string().regex(dateRe, 'data non valida'), descrizione: z.string().trim().min(2, 'descrizione troppo corta').max(300), categoria_id: z.coerce.number().int(),
  importo: importo(), metodo: z.enum(['DIPENDENTE', 'CARTA_AZIENDALE', 'FUEL_CARD']).default('DIPENDENTE'), fuel_card_id: opt(z.coerce.number().int()),
  motivazione: opt(z.string().trim().max(500)), cliente_org_id: opt(z.coerce.number().int()), progetto: opt(z.string().trim().max(200)), viaggio_id: opt(z.coerce.number().int()),
});

async function validaSpesa(ctx, n, b) {
  const e = controllaData(b.data, { anno: n.anno, mese: n.mese, oggi: oggi() });
  if (e) throw bad(e);
  const cat = (await categorieMap()).get(b.categoria_id);
  if (!cat || !cat.attiva) throw bad('Categoria non valida');
  if (b.metodo === 'FUEL_CARD') {
    const ben = await benefitPersona(n.person_id, { pieno: true, giorno: b.data });
    const card = ben.fuel_card.find((f) => f.id === b.fuel_card_id && f.in_corso);
    if (!card) throw bad('Scegli la fuel card assegnata e valida alla data della spesa (Contratti del personale)');
  } else b.fuel_card_id = null;
  if (b.viaggio_id && !(await one('SELECT 1 FROM viaggi WHERE id=$1 AND nota_id=$2', [b.viaggio_id, n.id]))) throw bad('Viaggio collegato inesistente');
  if (b.cliente_org_id && !(await one('SELECT 1 FROM public.organizations WHERE id=$1', [b.cliente_org_id]))) throw bad('Legal entity inesistente');
  return cat;
}

r.post('/note/:id/spese', ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await miaBozza(ctx, req.params.id);
  const b = parse(spesaSchema, req.body || {});
  await validaSpesa(ctx, n, b);
  const row = await tx(async (c) => {
    const x = (await c.query(`INSERT INTO spese (nota_id, data, descrizione, categoria_id, importo, metodo, fuel_card_id, motivazione, cliente_org_id, progetto, viaggio_id, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`, [n.id, b.data, b.descrizione, b.categoria_id, b.importo, b.metodo, b.fuel_card_id, b.motivazione || null, b.cliente_org_id || null, b.progetto || null, b.viaggio_id || null, ctx.uid])).rows[0];
    await ricalcola(n.id, c);
    return x;
  });
  res.status(201).json({ id: row.id, ...(await scheda(await caricaNota(n.id), ctx)) });
}));

r.put('/note/:id/spese/:sid', ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await miaBozza(ctx, req.params.id);
  const b = parse(spesaSchema, req.body || {});
  await validaSpesa(ctx, n, b);
  await tx(async (c) => {
    // modificare una riga esclusa dal responsabile la rimette in gioco (l'esclusione resta nello storico)
    const u = await c.query(`UPDATE spese SET data=$3, descrizione=$4, categoria_id=$5, importo=$6, metodo=$7, fuel_card_id=$8, motivazione=$9, cliente_org_id=$10, progetto=$11, viaggio_id=$12,
        esclusa=FALSE, esclusa_motivo=NULL, esclusa_da=NULL, esclusa_at=NULL, updated_at=now() WHERE id=$1 AND nota_id=$2`,
    [Number(req.params.sid), n.id, b.data, b.descrizione, b.categoria_id, b.importo, b.metodo, b.fuel_card_id, b.motivazione || null, b.cliente_org_id || null, b.progetto || null, b.viaggio_id || null]);
    if (!u.rowCount) throw notFound('Spesa inesistente');
    await ricalcola(n.id, c);
  });
  res.json(await scheda(await caricaNota(n.id), ctx));
}));

r.delete('/note/:id/spese/:sid', ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await miaBozza(ctx, req.params.id);
  await tx(async (c) => {
    const d = await c.query('DELETE FROM spese WHERE id=$1 AND nota_id=$2', [Number(req.params.sid), n.id]);
    if (!d.rowCount) throw notFound('Spesa inesistente');
    await c.query(`DELETE FROM allegati WHERE nota_id=$1 AND riga_tipo='SPESA' AND riga_id=$2`, [n.id, Number(req.params.sid)]);
    await ricalcola(n.id, c);
  });
  res.json(await scheda(await caricaNota(n.id), ctx));
}));

// ---------------------------------------------------------------- righe: Chilometri
const viaggioSchema = z.object({
  data: z.string().regex(dateRe, 'data non valida'), partenza: z.string().trim().min(2).max(200), arrivo: z.string().trim().min(2).max(200), andata_ritorno: z.boolean().default(false),
  motivazione: opt(z.string().trim().max(500)), km: z.preprocess((v) => (typeof v === 'string' ? Number(v.replace(',', '.')) : v), z.number().positive('km maggiori di zero').max(4999)),
  veicolo_tipo: z.enum(['PROPRIO', 'AZIENDALE']).default('PROPRIO'), veicolo_id: opt(z.coerce.number().int()), vettura_id: opt(z.coerce.number().int()),
  cliente_org_id: opt(z.coerce.number().int()), progetto: opt(z.string().trim().max(200)),
});

/** Viaggio pronto da salvare: con la vettura aziendale nessun rimborso (registro); con il veicolo proprio la tariffa si congela sulla riga */
async function preparaViaggio(ctx, n, b) {
  const e = controllaData(b.data, { anno: n.anno, mese: n.mese, oggi: oggi() });
  if (e) throw bad(e);
  const ben = await benefitPersona(n.person_id, { pieno: true, giorno: b.data });
  const vettura = ben.vetture.find((v) => v.in_corso) || null;
  const out = { ...b, tariffa: null, tariffa_fonte: null, rimborsabile: true, veicolo_testo: null };
  if (vettura || b.veicolo_tipo === 'AZIENDALE') {
    // chi ha la vettura aziendale non ha chilometri rimborsabili: solo il registro dei viaggi di servizio
    const v = vettura || ben.vetture.find((x) => x.id === b.vettura_id);
    if (!v) throw bad('Nessuna vettura aziendale assegnata alla data del viaggio');
    Object.assign(out, { veicolo_tipo: 'AZIENDALE', veicolo_id: null, vettura_id: v.id, rimborsabile: false, veicolo_testo: `${v.marca} ${v.modello} ${v.targa} (vettura aziendale)` });
  } else {
    const veic = b.veicolo_id ? await one('SELECT * FROM veicoli WHERE id=$1 AND person_id=$2', [b.veicolo_id, n.person_id]) : null;
    if (!veic) throw bad('Scegli il veicolo utilizzato (I miei veicoli: marca, modello, targa e tariffa ACI)');
    const s = ctx.settings;
    const def = s.tariffa_km_default != null && s.tariffa_km_default !== '' ? Number(s.tariffa_km_default) : null;
    const unica = s.tariffa_km_unica !== false && s.tariffa_km_unica !== 'false';   // tariffa unica aziendale (13/11/2026)
    Object.assign(out, { vettura_id: null, veicolo_testo: `${veic.marca} ${veic.modello} ${veic.targa}`,
      ...(unica && def != null ? { tariffa: def, tariffa_fonte: s.tariffa_km_default_fonte || 'tariffa unica aziendale' }
        : { tariffa: veic.tariffa != null ? Number(veic.tariffa) : def, tariffa_fonte: veic.tariffa != null ? veic.tariffa_fonte : def != null ? (s.tariffa_km_default_fonte || 'tariffa predefinita di P&C') : null }) });
  }
  Object.assign(out, importoViaggio(out));
  return out;
}

const VIAGGIO_COLS = ['data', 'partenza', 'arrivo', 'andata_ritorno', 'motivazione', 'km', 'km_totali', 'veicolo_tipo', 'veicolo_id', 'vettura_id', 'veicolo_testo', 'tariffa', 'tariffa_fonte', 'importo', 'rimborsabile', 'cliente_org_id', 'progetto'];
r.post('/note/:id/viaggi', ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await miaBozza(ctx, req.params.id);
  const v = await preparaViaggio(ctx, n, parse(viaggioSchema, req.body || {}));
  const row = await tx(async (c) => {
    const x = (await c.query(`INSERT INTO viaggi (nota_id, ${VIAGGIO_COLS.join(', ')}, created_by) VALUES ($1, ${VIAGGIO_COLS.map((_, i) => `$${i + 2}`).join(', ')}, $${VIAGGIO_COLS.length + 2}) RETURNING id`,
      [n.id, ...VIAGGIO_COLS.map((k) => v[k] ?? null), ctx.uid])).rows[0];
    await ricalcola(n.id, c);
    return x;
  });
  res.status(201).json({ id: row.id, ...(await scheda(await caricaNota(n.id), ctx)) });
}));
r.put('/note/:id/viaggi/:vid', ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await miaBozza(ctx, req.params.id);
  const v = await preparaViaggio(ctx, n, parse(viaggioSchema, req.body || {}));
  await tx(async (c) => {
    const u = await c.query(`UPDATE viaggi SET ${VIAGGIO_COLS.map((k, i) => `${k}=$${i + 3}`).join(', ')}, esclusa=FALSE, esclusa_motivo=NULL, esclusa_da=NULL, esclusa_at=NULL, updated_at=now() WHERE id=$1 AND nota_id=$2`,
      [Number(req.params.vid), n.id, ...VIAGGIO_COLS.map((k) => v[k] ?? null)]);
    if (!u.rowCount) throw notFound('Viaggio inesistente');
    await ricalcola(n.id, c);
  });
  res.json(await scheda(await caricaNota(n.id), ctx));
}));
r.delete('/note/:id/viaggi/:vid', ah(async (req, res) => {
  const ctx = await userContext(req);
  const n = await miaBozza(ctx, req.params.id);
  await tx(async (c) => {
    const d = await c.query('DELETE FROM viaggi WHERE id=$1 AND nota_id=$2', [Number(req.params.vid), n.id]);
    if (!d.rowCount) throw notFound('Viaggio inesistente');
    await c.query(`UPDATE spese SET viaggio_id=NULL WHERE nota_id=$1 AND viaggio_id=$2`, [n.id, Number(req.params.vid)]);
    await c.query(`DELETE FROM allegati WHERE nota_id=$1 AND riga_tipo='VIAGGIO' AND riga_id=$2`, [n.id, Number(req.params.vid)]);
    await ricalcola(n.id, c);
  });
  res.json(await scheda(await caricaNota(n.id), ctx));
}));

// ---------------------------------------------------------------- Nuova spesa dal telefono: foto + importo, categoria, data (descrizione facoltativa)
r.post('/spesa-rapida', upload.array('file', 6), ah(async (req, res) => {
  const ctx = await userContext(req);
  io(ctx);
  const b = parse(spesaSchema.extend({ descrizione: opt(z.string().trim().max(300)) }), req.body || {});
  const anno = Number(b.data.slice(0, 4)), mese = Number(b.data.slice(5, 7));
  const n0 = await notaDelMese(ctx, anno, mese);
  if (n0.stato !== 'BOZZA') throw bad(`La nota di ${nomeMese(anno, mese)} è ${STATO_LABEL[n0.stato].toLowerCase()}: non si aggiungono spese a un mese già inviato`);
  const n = await miaBozza(ctx, n0.id);
  const cat = await validaSpesa(ctx, n, b);
  const descr = b.descrizione || cat.nome;
  const id = await tx(async (c) => {
    const x = (await c.query(`INSERT INTO spese (nota_id, data, descrizione, categoria_id, importo, metodo, fuel_card_id, motivazione, cliente_org_id, progetto, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`, [n.id, b.data, descr, b.categoria_id, b.importo, b.metodo, b.fuel_card_id, b.motivazione || null, b.cliente_org_id || null, b.progetto || null, ctx.uid])).rows[0].id;
    for (const f of req.files || []) await salvaAllegato(c, { nota: n, tipo: 'SPESA', rigaId: x, file: f, userId: ctx.uid });
    await ricalcola(n.id, c);
    return x;
  });
  await audit(req, 'RIMBORSI_SPESA_RAPIDA', { module: KEY, entity: 'nota', entityId: n.id, label: `${nomeMese(anno, mese)}: ${cat.nome}`, data: { spesa: id, allegati: (req.files || []).length } });
  res.status(201).json({ nota_id: n.id, spesa_id: id, allegati: (req.files || []).length });
}));

// ---------------------------------------------------------------- veicoli propri (profilo del dipendente; P&C per chiunque)
const veicoloSchema = z.object({
  marca: z.string().trim().min(1).max(60), modello: z.string().trim().min(1).max(80), targa: z.string().trim().min(4).max(12).transform((v) => v.toUpperCase().replace(/\s+/g, '')),
  alimentazione: opt(z.string().trim().max(40)),
  tariffa: z.preprocess((v) => (v === '' || v == null ? null : typeof v === 'string' ? Number(v.replace(',', '.')) : v), z.number().positive().max(9.9999).nullable()).optional(),
  tariffa_fonte: opt(z.string().trim().max(200)), attivo: z.boolean().default(true),
});
const personaVeicoli = (ctx, pid) => {
  const id = pid ? Number(pid) : ctx.personId;
  if (id !== ctx.personId && !ctx.isPC) throw forbidden('I veicoli di un altro dipendente li gestisce solo P&C');
  if (!ctx.perim.persone.has(id)) throw notFound('Dipendente non trovato');
  return id;
};
r.get('/veicoli', ah(async (req, res) => {
  const ctx = await userContext(req);
  const pid = personaVeicoli(ctx, req.query.person_id);
  const benefit = await benefitPersona(pid, { pieno: true });
  res.json({ veicoli: await many('SELECT * FROM veicoli WHERE person_id=$1 ORDER BY attivo DESC, id', [pid]), benefit,
    tariffa_default: ctx.settings.tariffa_km_default != null && ctx.settings.tariffa_km_default !== '' ? { tariffa: Number(ctx.settings.tariffa_km_default), fonte: ctx.settings.tariffa_km_default_fonte || '', unica: ctx.settings.tariffa_km_unica !== false && ctx.settings.tariffa_km_unica !== 'false' } : null });
}));
async function scriviVeicolo(req, res, id) {
  const ctx = await userContext(req);
  const pid = personaVeicoli(ctx, req.body?.person_id || req.query.person_id);
  const b = parse(veicoloSchema, req.body || {});
  if (b.tariffa != null && !b.tariffa_fonte) throw bad('Indica la fonte della tariffa (es. "tabelle ACI 2026, modello e alimentazione")');
  let row;
  if (id) {
    row = await one(`UPDATE veicoli SET marca=$3, modello=$4, targa=$5, alimentazione=$6, tariffa=$7, tariffa_fonte=$8, attivo=$9, updated_by=$10, updated_at=now() WHERE id=$1 AND person_id=$2 RETURNING *`,
      [id, pid, b.marca, b.modello, b.targa, b.alimentazione || null, b.tariffa ?? null, b.tariffa_fonte || null, b.attivo, ctx.uid]);
    if (!row) throw notFound('Veicolo inesistente');
  } else {
    row = await one(`INSERT INTO veicoli (person_id, marca, modello, targa, alimentazione, tariffa, tariffa_fonte, attivo, created_by, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING *`,
      [pid, b.marca, b.modello, b.targa, b.alimentazione || null, b.tariffa ?? null, b.tariffa_fonte || null, b.attivo, ctx.uid]);
  }
  // la tariffa nuova completa i viaggi delle note in BOZZA rimasti senza tariffa (le righe con una tariffa già congelata non cambiano)
  if (row.tariffa != null) {
    const ag = await many(`UPDATE viaggi v SET tariffa=$2, tariffa_fonte=$3, importo=round(v.km_totali * $2, 2), updated_at=now() FROM note n
        WHERE n.id = v.nota_id AND n.stato = 'BOZZA' AND v.veicolo_id = $1 AND v.tariffa IS NULL AND v.rimborsabile RETURNING v.nota_id`, [row.id, row.tariffa, row.tariffa_fonte]);
    for (const nid of new Set(ag.map((x) => x.nota_id))) await ricalcola(nid);
  }
  await audit(req, id ? 'RIMBORSI_VEICOLO_MODIFICATO' : 'RIMBORSI_VEICOLO_AGGIUNTO', { module: KEY, entity: 'veicolo', entityId: row.id, label: `${row.marca} ${row.modello}`, data: { person_id: pid, tariffa: row.tariffa, fonte: row.tariffa_fonte } });
  res.status(id ? 200 : 201).json(row);
}
r.post('/veicoli', ah((req, res) => scriviVeicolo(req, res, null)));
r.put('/veicoli/:vid', ah((req, res) => scriviVeicolo(req, res, Number(req.params.vid))));
r.delete('/veicoli/:vid', ah(async (req, res) => {
  const ctx = await userContext(req);
  const v = await one('SELECT * FROM veicoli WHERE id=$1', [Number(req.params.vid)]);
  if (!v) throw notFound('Veicolo inesistente');
  personaVeicoli(ctx, v.person_id);
  const usato = await one('SELECT 1 FROM viaggi WHERE veicolo_id=$1 LIMIT 1', [v.id]);
  if (usato) { await q('UPDATE veicoli SET attivo=FALSE, updated_at=now() WHERE id=$1', [v.id]); return res.json({ ok: true, disattivato: true }); }
  await q('DELETE FROM veicoli WHERE id=$1', [v.id]);
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- Legal entity (cliente o progetto collegabile)
r.get('/legal-entity', ah(async (req, res) => {
  const t = String(req.query.q || '').trim();
  if (t.length < 2) return res.json([]);
  res.json(await many(`SELECT id, name, kind, city FROM public.organizations WHERE active AND (name ILIKE '%' || $1 || '%' OR code ILIKE $1 || '%') ORDER BY lower(name) LIMIT 15`, [t]));
}));

export default r;
