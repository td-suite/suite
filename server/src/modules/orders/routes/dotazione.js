// Dotazione di avvio sedi (richiesta del CEO, 31/10/2026): sezione di impostazione dopo il Magazzino Centrale.
// a) Modelli per tipologia: l'elenco completo del materiale di avvio per Punto Prelievi, Centro Polidiagnostico, Laboratorio di
//    Analisi e Cliente service / Legal entity (startup_templates, startup_template_lines; articoli attivi del catalogo Silva).
// b) Sedi: sedi dell'anagrafica unica (public.sites dei tipi con dotazione) e Legal entity (clienti service e partner) con la data
//    di effettiva apertura (public.sites.opened_at; per la Legal entity startup_loads.start_date), il piano della singola
//    struttura (startup_loads, startup_load_lines), l'ordine facoltativo al Magazzino Centrale e la Giacenza 0: confezioni in
//    packages con origin 'INIZIALE' e stato RICEVUTO (stessa logica del carico iniziale, caricoIniziale in lib/orders.js).
// Permessi: Area Operations (SUPERADMIN, PROCUREMENT); "Annulla Giacenza 0" solo SUPERADMIN. Audit su ogni scrittura.
import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { one, many, q, tx } from '../db.js';
import { ah, bad, notFound, audit, parse, todayRome, HttpError } from '../lib/util.js';
import { requireRole, OPS_ROLES } from '../lib/access.js';
import { caricoIniziale, companyInfo } from '../lib/orders.js';
import { TIPOLOGIE, TIPOLOGIA_KINDS, SITE_KINDS_DOTAZIONE, nomeTipologia, tipologiaDaSiteKind, statoDotazione, totaliDotazione, giorniAllApertura, daAttenzionare, contaBadge } from '../lib/dotazione.js';
import { audit as auditCore } from '../../../lib/util.js';
import { creaOrdine } from './orders.js';
import { buildDotazionePdf } from '../pdf/dotazione.js';

const r = Router();
r.use(requireRole(...OPS_ROLES));
const opt = (s) => s.optional().nullable().transform((v) => (v === '' ? null : v));
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const conflict = (msg) => new HttpError(409, msg);
const ORG_KINDS = ['CLIENTE', 'PARTNER'];   // Legal entity con dotazione: clienti service e partner

// Colonne dell'articolo per righe di modello e di carico (icona della categoria per la grafica)
const ART = `a.code AS article_code, a.silva_code, a.name AS article_name, a.unit, a.pack_label, a.color, a.active AS article_active, a.source, c.icon, c.name AS category_name, c.sort AS category_sort`;

function assertKind(kind) {
  if (!TIPOLOGIA_KINDS.includes(kind)) throw notFound('Tipologia inesistente');
  return kind;
}
// Articolo utilizzabile nella dotazione: attivo e del catalogo Silva (il catalogo del Magazzino Centrale)
async function assertArticolo(id, client) {
  const run = client ? (s, p) => client.query(s, p).then((x) => x.rows[0]) : one;
  const a = await run('SELECT id, code, name, active, source FROM articles WHERE id=$1', [id]);
  if (!a) throw bad(`Articolo ${id} inesistente`);
  if (!a.active || a.source !== 'SILVA') throw bad(`${a.name}: solo articoli attivi del catalogo Silva`);
  return a;
}

// ---------------- Catalogo per la ricerca (solo articoli attivi del catalogo Silva) ----------------
r.get('/articoli', ah(async (req, res) => {
  const s = String(req.query.q || '').trim();
  res.json(await many(`SELECT a.id, ${ART} FROM articles a JOIN categories c ON c.code=a.category_code
    WHERE a.active AND a.source='SILVA' AND ($1 = '' OR a.code ILIKE '%'||$1||'%' OR a.silva_code ILIKE '%'||$1||'%' OR a.name ILIKE '%'||$1||'%')
    ORDER BY c.sort, a.sort, a.name LIMIT 60`, [s]));
}));

// ---------------- a) Modelli per tipologia ----------------
r.get('/modelli', ah(async (_req, res) => {
  const rows = await many(`SELECT t.kind, t.name, t.updated_at, u.full_name AS updated_by_name,
      (SELECT count(*)::int FROM startup_template_lines l WHERE l.kind=t.kind) AS lines,
      (SELECT coalesce(sum(l.packs),0)::int FROM startup_template_lines l WHERE l.kind=t.kind) AS packs
    FROM startup_templates t LEFT JOIN users u ON u.id=t.updated_by`);
  res.json(TIPOLOGIE.map((t) => rows.find((x) => x.kind === t.kind) || { ...t, lines: 0, packs: 0 }));
}));

async function modello(kind) {
  const t = await one('SELECT t.*, u.full_name AS updated_by_name FROM startup_templates t LEFT JOIN users u ON u.id=t.updated_by WHERE t.kind=$1', [kind]);
  const lines = await many(`SELECT l.id, l.article_id, l.packs, l.note, l.sort, ${ART} FROM startup_template_lines l JOIN articles a ON a.id=l.article_id JOIN categories c ON c.code=a.category_code
    WHERE l.kind=$1 ORDER BY c.sort, l.sort, a.name`, [kind]);
  return { ...(t || { kind, name: nomeTipologia(kind) }), lines, totali: totaliDotazione(lines) };
}
const toccaModello = (kind, userId, client) => (client ? client.query.bind(client) : q)('UPDATE startup_templates SET updated_at=now(), updated_by=$2 WHERE kind=$1', [kind, userId]);

r.get('/modelli/:kind', ah(async (req, res) => res.json(await modello(assertKind(req.params.kind)))));

// Aggiunta di un articolo (se c'è già, si aggiornano confezioni e note)
r.post('/modelli/:kind/righe', ah(async (req, res) => {
  const kind = assertKind(req.params.kind);
  const d = parse(z.object({ article_id: z.coerce.number().int(), packs: z.coerce.number().int().min(1).max(9999).default(1), note: opt(z.string().max(300)) }), req.body);
  await assertArticolo(d.article_id);
  const row = await one(`INSERT INTO startup_template_lines (kind, article_id, packs, note, sort) VALUES ($1,$2,$3,$4,(SELECT coalesce(max(sort),0)+1 FROM startup_template_lines WHERE kind=$1))
    ON CONFLICT (kind, article_id) DO UPDATE SET packs=EXCLUDED.packs, note=coalesce(EXCLUDED.note, startup_template_lines.note) RETURNING id`, [kind, d.article_id, d.packs, d.note]);
  await toccaModello(kind, req.user.id);
  await audit(req, 'DOTAZIONE_MODELLO_RIGA', 'startup_template', kind, d);
  res.status(201).json(row);
}));
r.put('/modelli/:kind/righe/:id', ah(async (req, res) => {
  const kind = assertKind(req.params.kind);
  const d = parse(z.object({ packs: z.coerce.number().int().min(1).max(9999).optional(), note: opt(z.string().max(300)) }), req.body);
  const row = await one('UPDATE startup_template_lines SET packs=coalesce($3, packs), note=CASE WHEN $4::boolean THEN $5 ELSE note END WHERE id=$1 AND kind=$2 RETURNING id',
    [req.params.id, kind, d.packs ?? null, 'note' in d, d.note ?? null]);
  if (!row) throw notFound('Riga non trovata');
  await toccaModello(kind, req.user.id);
  await audit(req, 'DOTAZIONE_MODELLO_RIGA', 'startup_template', kind, { id: row.id, ...d });
  res.json({ ok: true });
}));
r.delete('/modelli/:kind/righe/:id', ah(async (req, res) => {
  const kind = assertKind(req.params.kind);
  const row = await one('DELETE FROM startup_template_lines WHERE id=$1 AND kind=$2 RETURNING article_id', [req.params.id, kind]);
  if (!row) throw notFound('Riga non trovata');
  await toccaModello(kind, req.user.id);
  await audit(req, 'DOTAZIONE_MODELLO_RIGA_ELIMINA', 'startup_template', kind, { id: Number(req.params.id), article_id: row.article_id });
  res.json({ ok: true });
}));

// Copia da un'altra tipologia: AGGIUNGI (default) integra gli articoli mancanti senza toccare quelli presenti; SOSTITUISCI rifà il modello
r.post('/modelli/:kind/copia', ah(async (req, res) => {
  const kind = assertKind(req.params.kind);
  const d = parse(z.object({ from: z.enum(TIPOLOGIA_KINDS), mode: z.enum(['AGGIUNGI', 'SOSTITUISCI']).default('AGGIUNGI') }), req.body);
  if (d.from === kind) throw bad('Scegli una tipologia diversa');
  const n = await tx(async (c) => {
    if (d.mode === 'SOSTITUISCI') await c.query('DELETE FROM startup_template_lines WHERE kind=$1', [kind]);
    const ins = await c.query(`INSERT INTO startup_template_lines (kind, article_id, packs, note, sort)
      SELECT $1, l.article_id, l.packs, l.note, l.sort FROM startup_template_lines l JOIN articles a ON a.id=l.article_id
       WHERE l.kind=$2 AND a.active AND a.source='SILVA' ON CONFLICT (kind, article_id) DO NOTHING`, [kind, d.from]);
    await toccaModello(kind, req.user.id, c);
    return ins.rowCount;
  });
  await audit(req, 'DOTAZIONE_MODELLO_COPIA', 'startup_template', kind, { ...d, copiate: n });
  res.json({ copiate: n });
}));

r.get('/modelli/:kind/export.xlsx', ah(async (req, res) => {
  const m = await modello(assertKind(req.params.kind));
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Dotazione di avvio');
  ws.addRow([`Dotazione di avvio · ${m.name}`]); ws.getRow(1).font = { bold: true, size: 13 };
  ws.addRow([`${m.totali.articoli} articoli, ${m.totali.pianificate} confezioni`]);
  ws.addRow([]);
  ws.addRow(['Categoria', 'Codice', 'Codice Silva', 'Articolo', 'Confezione', 'Confezioni', 'Note']); ws.getRow(4).font = { bold: true };
  for (const l of m.lines) ws.addRow([l.category_name, l.article_code, l.silva_code, l.article_name, l.pack_label, l.packs, l.note]);
  ws.columns.forEach((c, i) => { c.width = [22, 14, 16, 56, 30, 12, 40][i]; });
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="dotazione_avvio_${m.kind.toLowerCase()}.xlsx"`);
  res.send(Buffer.from(await wb.xlsx.writeBuffer()));
}));

// ---------------- b) Sedi e Legal entity ----------------
// Elenco: sedi dei tipi con dotazione e Legal entity clienti service e partner, con data di apertura, stato e totali
const SEDI_SQL = `SELECT s.id, s.origin, s.site_id, s.org_id, s.code, s.name, s.site_kind, s.org_kind, s.kind AS flow_kind, s.address, s.zip, s.city, s.province, s.active,
    s.referente, s.referente_phone, s.phone, s.email, s.organization_name,
    CASE WHEN s.origin='SITE' THEN ps.opened_at ELSE l.start_date END AS opened_at,
    l.id AS load_id, l.kind AS load_kind, l.status, l.planned_at, l.delivered_at, l.order_id, l.note AS load_note, o.number AS order_number, o.status AS order_status,
    coalesce((SELECT sum(x.packs_planned) FROM startup_load_lines x WHERE x.load_id=l.id),0)::int AS packs_planned,
    coalesce((SELECT sum(x.packs_delivered) FROM startup_load_lines x WHERE x.load_id=l.id),0)::int AS packs_delivered,
    (SELECT count(*)::int FROM startup_load_lines x WHERE x.load_id=l.id) AS lines
  FROM strutture_v s
  LEFT JOIN public.sites ps ON ps.id = s.site_id
  LEFT JOIN startup_loads l ON l.struttura_id = s.id
  LEFT JOIN orders o ON o.id = l.order_id`;
const SEDI_WHERE = `((s.origin='SITE' AND s.site_kind = ANY($1::text[])) OR (s.origin='ORG' AND s.org_kind = ANY($2::text[])))`;

function arricchisci(s, oggi) {
  const kind = s.load_kind || tipologiaDaSiteKind(s.site_kind, s.origin);
  return { ...s, tipologia: kind, tipologia_name: nomeTipologia(kind), stato: statoDotazione(s.load_id ? s : null), giorni: giorniAllApertura(s.opened_at, oggi), attenzione: daAttenzionare(s, oggi) };
}
async function elencoSedi() {
  const oggi = todayRome();
  const rows = await many(`${SEDI_SQL} WHERE s.active AND ${SEDI_WHERE} ORDER BY s.origin DESC, CASE WHEN s.origin='SITE' THEN ps.opened_at ELSE l.start_date END NULLS LAST, s.name`, [SITE_KINDS_DOTAZIONE, ORG_KINDS]);
  return rows.map((s) => arricchisci(s, oggi));
}
// Badge del menu: sedi e Legal entity con apertura entro 60 giorni (o già aperte) senza Giacenza 0 (usato da index.js /badges)
export async function badgeDotazione() {
  return contaBadge(await elencoSedi(), todayRome());
}

r.get('/sedi', ah(async (_req, res) => {
  const rows = await elencoSedi();
  res.json({ rows, badge: rows.filter((x) => x.attenzione).length, oggi: todayRome() });
}));

async function strutturaDotazione(id) {
  const s = await one(`${SEDI_SQL} WHERE s.id=$3 AND ${SEDI_WHERE}`, [SITE_KINDS_DOTAZIONE, ORG_KINDS, Number(id) || 0]);
  if (!s) throw notFound('Struttura senza dotazione di avvio: servono una sede Punto Prelievi, Centro Polidiagnostico o Laboratorio, oppure una Legal entity cliente service o partner');
  return arricchisci(s, todayRome());
}
async function righeCarico(loadId) {
  if (!loadId) return [];
  return many(`SELECT l.id, l.article_id, l.packs_planned, l.packs_delivered, l.lot, l.expiry, l.note, l.sort, ${ART}
    FROM startup_load_lines l JOIN articles a ON a.id=l.article_id JOIN categories c ON c.code=a.category_code WHERE l.load_id=$1 ORDER BY c.sort, l.sort, a.name`, [loadId]);
}
async function dettaglio(id) {
  const s = await strutturaDotazione(id);
  const lines = await righeCarico(s.load_id);
  const load = s.load_id ? await one(`SELECT l.*, pu.full_name AS planned_by_name, du.full_name AS delivered_by_name FROM startup_loads l
      LEFT JOIN users pu ON pu.id=l.planned_by LEFT JOIN users du ON du.id=l.delivered_by WHERE l.id=$1`, [s.load_id]) : null;
  const modelloInfo = await one('SELECT count(*)::int AS lines, coalesce(sum(packs),0)::int AS packs FROM startup_template_lines WHERE kind=$1', [s.tipologia]);
  // Giacenza 0 ancora in giacenza / già messa in uso (per l'annullamento)
  const pk = s.load_id ? await one(`SELECT count(*) FILTER (WHERE status='RICEVUTO')::int AS ricevute, count(*) FILTER (WHERE status<>'RICEVUTO')::int AS movimentate FROM packages WHERE startup_load_id=$1`, [s.load_id]) : { ricevute: 0, movimentate: 0 };
  return { struttura: s, load, lines, totali: totaliDotazione(lines), modello: { kind: s.tipologia, name: s.tipologia_name, ...modelloInfo }, packages: pk };
}
r.get('/sedi/:id', ah(async (req, res) => res.json(await dettaglio(req.params.id))));

// Riga del carico, creata alla prima scrittura (stato NON_PIANIFICATA finché non si salva il piano)
async function assicuraCarico(c, s, userId) {
  const ins = await c.query(`INSERT INTO startup_loads (struttura_id, kind) VALUES ($1,$2) ON CONFLICT (struttura_id) DO NOTHING RETURNING id`, [s.id, s.tipologia]);
  if (ins.rows[0]) return ins.rows[0].id;
  return (await c.query('SELECT id FROM startup_loads WHERE struttura_id=$1', [s.id])).rows[0].id;
}
const nonConsegnata = (s) => { if (s.stato === 'CONSEGNATA') throw conflict('Giacenza 0 già registrata: il piano non si modifica (il super amministratore può annullarla)'); };

// Data di effettiva apertura: per la sede scrive public.sites.opened_at (anagrafica unica, audit nel core e nel modulo); per la
// Legal entity la data di avvio del rapporto in startup_loads.start_date (organizations non ha una data di apertura)
r.put('/sedi/:id/apertura', ah(async (req, res) => {
  const s = await strutturaDotazione(req.params.id);
  const { opened_at } = parse(z.object({ opened_at: z.union([DATE, z.literal(''), z.null()]).transform((v) => v || null) }), req.body);
  if (s.origin === 'SITE') {
    await q('UPDATE public.sites SET opened_at=$2, updated_at=now() WHERE id=$1', [s.site_id, opened_at]);
    await auditCore({ user: req.suiteUser, ip: req.ip }, 'SITE_UPDATED', { module: 'orders', entity: 'site', entityId: s.site_id, label: `${s.code} ${s.name}`, data: { opened_at, prima: s.opened_at, da: 'Ordini > Dotazione di avvio sedi' } });
  } else {
    await tx(async (c) => {
      const id = await assicuraCarico(c, s, req.user.id);
      await c.query('UPDATE startup_loads SET start_date=$2, updated_at=now() WHERE id=$1', [id, opened_at]);
    });
  }
  await audit(req, 'DOTAZIONE_APERTURA', 'struttura', s.id, { origin: s.origin, opened_at, prima: s.opened_at });
  res.json(await dettaglio(s.id));
}));

// "Genera dal modello": il carico riparte dalle righe del modello della tipologia (si modificano poi per la singola sede)
r.post('/sedi/:id/genera', ah(async (req, res) => {
  const s = await strutturaDotazione(req.params.id);
  nonConsegnata(s);
  const n = await tx(async (c) => {
    const id = await assicuraCarico(c, s, req.user.id);
    await c.query('DELETE FROM startup_load_lines WHERE load_id=$1', [id]);
    const ins = await c.query(`INSERT INTO startup_load_lines (load_id, article_id, packs_planned, note, sort)
      SELECT $1, l.article_id, l.packs, l.note, l.sort FROM startup_template_lines l JOIN articles a ON a.id=l.article_id WHERE l.kind=$2 AND a.active AND a.source='SILVA'`, [id, s.tipologia]);
    await c.query('UPDATE startup_loads SET kind=$2, updated_at=now() WHERE id=$1', [id, s.tipologia]);
    return ins.rowCount;
  });
  if (!n) throw bad(`Il modello ${s.tipologia_name} è vuoto: compilalo nella scheda Modelli per tipologia`);
  await audit(req, 'DOTAZIONE_GENERA', 'struttura', s.id, { tipologia: s.tipologia, righe: n });
  res.json(await dettaglio(s.id));
}));

// "Salva piano": righe della singola sede (aggiungi, togli, cambia quantità) e stato PIANIFICATA
r.put('/sedi/:id/piano', ah(async (req, res) => {
  const s = await strutturaDotazione(req.params.id);
  nonConsegnata(s);
  const d = parse(z.object({
    lines: z.array(z.object({ article_id: z.coerce.number().int(), packs_planned: z.coerce.number().int().min(0).max(9999), lot: opt(z.string().max(60)), expiry: opt(DATE), note: opt(z.string().max(300)) })).max(500),
    note: opt(z.string().max(1000)),
  }), req.body);
  const lines = d.lines.filter((l) => l.packs_planned > 0);
  if (!lines.length) throw bad('Il piano è vuoto: genera dal modello o aggiungi almeno un articolo');
  if (new Set(lines.map((l) => l.article_id)).size !== lines.length) throw bad('Lo stesso articolo compare due volte');
  await tx(async (c) => {
    for (const l of lines) await assertArticoloPiano(c, l.article_id, s);
    const id = await assicuraCarico(c, s, req.user.id);
    await c.query('DELETE FROM startup_load_lines WHERE load_id=$1', [id]);
    for (const [i, l] of lines.entries()) await c.query('INSERT INTO startup_load_lines (load_id, article_id, packs_planned, lot, expiry, note, sort) VALUES ($1,$2,$3,$4,$5,$6,$7)', [id, l.article_id, l.packs_planned, l.lot, l.expiry, l.note, i + 1]);
    await c.query(`UPDATE startup_loads SET status='PIANIFICATA', kind=$2, note=$3, planned_at=now(), planned_by=$4, updated_at=now() WHERE id=$1`, [id, s.tipologia, d.note, req.user.id]);
  });
  await audit(req, 'DOTAZIONE_PIANO', 'struttura', s.id, { righe: lines.length, confezioni: lines.reduce((a, l) => a + l.packs_planned, 0) });
  res.json(await dettaglio(s.id));
}));
// Un articolo già nel piano salvato resta ammesso anche se nel frattempo è stato disattivato; i nuovi devono essere Silva e attivi
async function assertArticoloPiano(c, articleId, s) {
  if (s.load_id) {
    const gia = (await c.query('SELECT 1 FROM startup_load_lines WHERE load_id=$1 AND article_id=$2', [s.load_id, articleId])).rows[0];
    if (gia) return;
  }
  await assertArticolo(articleId, c);
}

// "Crea ordine al Magazzino Centrale" (facoltativo): ordine in BOZZA del modulo per la struttura con le righe pianificate
r.post('/sedi/:id/ordine', ah(async (req, res) => {
  const s = await strutturaDotazione(req.params.id);
  if (s.stato === 'NON_PIANIFICATA') throw bad('Salva prima il piano');
  if (s.order_id && s.order_status !== 'ANNULLATO') throw conflict(`Ordine già creato: ${s.order_number}`);
  const lines = (await righeCarico(s.load_id)).filter((l) => l.packs_planned > 0).map((l) => ({ article_id: l.article_id, qty: l.packs_planned, note: l.note }));
  const o = await creaOrdine(req, { strutturaId: s.id, lines, notes: `Dotazione di avvio${s.opened_at ? ` (apertura ${s.opened_at.split('-').reverse().join('/')})` : ''}`, eventLabel: 'Creato dalla Dotazione di avvio' });
  await q('UPDATE startup_loads SET order_id=$2, updated_at=now() WHERE id=$1', [s.load_id, o.id]);
  await audit(req, 'DOTAZIONE_ORDINE', 'struttura', s.id, { order_id: o.id, number: o.number });
  res.status(201).json({ ...o, dettaglio: await dettaglio(s.id) });
}));

// "Registra la Giacenza 0": per ogni riga packs_delivered confezioni RICEVUTO con origin INIZIALE, received_at = data scelta
// (default data di apertura, altrimenti oggi), received_by l'utente, note "Dotazione di avvio"; non ripetibile (409)
r.post('/sedi/:id/giacenza-zero', ah(async (req, res) => {
  const s = await strutturaDotazione(req.params.id);
  if (s.stato === 'CONSEGNATA') throw conflict('Giacenza 0 già registrata per questa struttura');
  if (s.stato !== 'PIANIFICATA') throw bad('Salva prima il piano della dotazione');
  const d = parse(z.object({
    date: opt(DATE),
    lines: z.array(z.object({ article_id: z.coerce.number().int(), packs_delivered: z.coerce.number().int().min(0).max(9999).optional(), lot: opt(z.string().max(60)), expiry: opt(DATE) })).optional(),
  }), req.body || {});
  const data = d.date || s.opened_at || todayRome();
  const piano = await righeCarico(s.load_id);
  const override = new Map((d.lines || []).map((l) => [l.article_id, l]));
  const righe = piano.map((l) => {
    const o = override.get(l.article_id) || {};
    return { id: l.id, article_id: l.article_id, qty: o.packs_delivered ?? l.packs_planned, lot: o.lot !== undefined ? o.lot : l.lot, expiry: o.expiry !== undefined ? o.expiry : l.expiry };
  });
  if (!righe.some((l) => l.qty > 0)) throw bad('Nessuna confezione da registrare');
  const n = await tx(async (c) => {
    // blocco della riga: due registrazioni contemporanee non creano due Giacenze 0
    const cur = (await c.query('SELECT status FROM startup_loads WHERE id=$1 FOR UPDATE', [s.load_id])).rows[0];
    if (cur?.status === 'CONSEGNATA') throw conflict('Giacenza 0 già registrata per questa struttura');
    for (const l of righe) await c.query('UPDATE startup_load_lines SET packs_delivered=$2, lot=$3, expiry=$4 WHERE id=$1', [l.id, l.qty, l.lot || null, l.expiry || null]);
    const tot = await caricoIniziale(c, { strutturaId: s.id, lines: righe, userId: req.user.id, note: 'Dotazione di avvio', receivedAt: `${data} 12:00:00 Europe/Rome`, startupLoadId: s.load_id });
    await c.query(`UPDATE startup_loads SET status='CONSEGNATA', delivered_at=$2::timestamptz, delivered_by=$3, updated_at=now() WHERE id=$1`, [s.load_id, `${data} 12:00:00 Europe/Rome`, req.user.id]);
    return tot;
  });
  await audit(req, 'DOTAZIONE_GIACENZA_ZERO', 'struttura', s.id, { data, confezioni: n, righe: righe.filter((l) => l.qty > 0).length });
  res.status(201).json({ confezioni: n, dettaglio: await dettaglio(s.id) });
}));

// "Annulla Giacenza 0" (solo super amministratore): toglie le confezioni INIZIALE del carico ancora RICEVUTO; quelle già messe in
// uso o rettificate restano (sono movimenti della sede) e vengono contate nella risposta. Il piano torna PIANIFICATA.
r.post('/sedi/:id/annulla-giacenza-zero', requireRole('SUPERADMIN'), ah(async (req, res) => {
  const s = await strutturaDotazione(req.params.id);
  if (s.stato !== 'CONSEGNATA') throw bad('Giacenza 0 non registrata');
  const out = await tx(async (c) => {
    const del = await c.query(`DELETE FROM packages WHERE startup_load_id=$1 AND origin='INIZIALE' AND status='RICEVUTO'`, [s.load_id]);
    const rest = (await c.query('SELECT count(*)::int AS n FROM packages WHERE startup_load_id=$1', [s.load_id])).rows[0].n;
    await c.query('UPDATE startup_load_lines SET packs_delivered=NULL WHERE load_id=$1', [s.load_id]);
    await c.query(`UPDATE startup_loads SET status='PIANIFICATA', delivered_at=NULL, delivered_by=NULL, updated_at=now() WHERE id=$1`, [s.load_id]);
    return { tolte: del.rowCount, restano_movimentate: rest };
  });
  await audit(req, 'DOTAZIONE_GIACENZA_ZERO_ANNULLA', 'struttura', s.id, out);
  res.json({ ...out, dettaglio: await dettaglio(s.id) });
}));

// Stampa della dotazione (lista con icone, quantità, lotto e scadenza, firma per ricevuta)
r.get('/sedi/:id/pdf', ah(async (req, res) => {
  const det = await dettaglio(req.params.id);
  if (!det.lines.length) throw bad('Nessuna riga: genera la dotazione dal modello');
  const pdf = await buildDotazionePdf({ ...det, company: await companyInfo() });
  await audit(req, 'DOTAZIONE_PDF', 'struttura', det.struttura.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="dotazione_avvio_${det.struttura.code}.pdf"`);
  res.send(pdf);
}));

export default r;
