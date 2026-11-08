// Finance Management · Controllo di gestione (programma "anagrafica unica", decisioni 11 e 12, CEO 08/11/2026):
//  - conto economico di sede (P&L): GET /controllo/conto-economico (+ export.xlsx, export.pdf)
//  - margine per cliente Service: GET /controllo/margine-service (+ export.xlsx, export.pdf, dettaglio del cliente mese per mese)
//  - produzione Service inserita a mano, da XLSX o come stima salvata (finance.produzione_service)
//  - costi analitici per esame da XLSX (finance.costi_esami, Impostazioni)
//  - elenchi per i selettori "Sede / centro di costo" e "Cliente" delle istanze.
// Lettura: tutti i profili del modulo (CEO, CFO, SUPPORT, VIEWER). Scrittura della produzione: Finance Support e amministratori
// (canManage); costi esami: amministratori (come le Impostazioni). Calcoli in lib/contoEconomico.js, fonti in lib/controlloData.js.
import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { many, one, q } from '../db.js';
import { ah, bad, notFound, audit, parse, suiteAudit, todayRome } from '../lib/util.js';
import { requireManage, requireAdmin } from '../lib/access.js';
import * as CE from '../lib/contoEconomico.js';
import { contoEconomico, caricaService, impostazioniControllo, leggi, sommaMesi } from '../lib/controlloData.js';
import { contoXlsx, contoPdf, margineXlsx, marginePdf, CALCOLO_PL, CALCOLO_SRV } from '../lib/controlloExport.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
const periodoDa = (req) => {
  try { return CE.periodo(req.query.anno || new Date().getFullYear(), req.query.mese || null, todayRome()); }
  catch (e) { throw bad(e.message); }
};
const nomeFile = (base, p, ext) => `${base}_${p.mese ? CE.meseKey(p.anno, p.mese) : p.anno}.${ext}`;
const invia = (res, buf, filename, type) => { res.setHeader('Content-Type', type); res.setHeader('Content-Disposition', `attachment; filename="${filename}"`); res.send(Buffer.from(buf)); };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// ---------------------------------------------------------------- conto economico di sede
r.get('/conto-economico', ah(async (req, res) => {
  const p = periodoDa(req);
  const d = await contoEconomico(p, { siteId: req.query.site_id ? Number(req.query.site_id) : null });
  res.json({ ...d, come_calcolato: CALCOLO_PL(d.impostazioni, d.laboratorio) });
}));
r.get('/conto-economico/export.xlsx', ah(async (req, res) => {
  const p = periodoDa(req);
  const d = await contoEconomico(p, { siteId: req.query.site_id ? Number(req.query.site_id) : null });
  await audit(req, 'PL_EXPORT', 'conto_economico', null, { periodo: p.etichetta, formato: 'XLSX' });
  invia(res, await contoXlsx(d), nomeFile('Conto_economico_sedi', p, 'xlsx'), XLSX);
}));
r.get('/conto-economico/export.pdf', ah(async (req, res) => {
  const p = periodoDa(req);
  const d = await contoEconomico(p, { siteId: req.query.site_id ? Number(req.query.site_id) : null });
  await audit(req, 'PL_EXPORT', 'conto_economico', null, { periodo: p.etichetta, formato: 'PDF' });
  invia(res, await contoPdf(d), nomeFile('Conto_economico_sedi', p, 'pdf'), 'application/pdf');
}));

// ---------------------------------------------------------------- margine per cliente Service
async function margine(p, orgId = null) {
  const s = await caricaService(p, { orgId });
  const totale = sommaMesi(s.clienti.map((c) => c.totale).map((t) => ({ ...t, produzione: null })));
  totale.fonti = [...new Set(s.clienti.flatMap((c) => c.totale.fonti))];
  totale.ricavo_parziale = totale.ricavo_parziale || s.clienti.some((c) => c.totale.ricavo_parziale);
  return { periodo: p, ...s, totale };
}
r.get('/margine-service', ah(async (req, res) => {
  const p = periodoDa(req);
  const d = await margine(p, req.query.org ? Number(req.query.org) : null);
  res.json({ ...d, come_calcolato: CALCOLO_SRV(d.impostazioni, d.giorni_lavorativi_anno) });
}));
r.get('/margine-service/export.xlsx', ah(async (req, res) => {
  const p = periodoDa(req);
  const d = await margine(p);
  await audit(req, 'MARGINE_SRV_EXPORT', 'margine_service', null, { periodo: p.etichetta, formato: 'XLSX' });
  invia(res, await margineXlsx(d), nomeFile('Margine_clienti_Service', p, 'xlsx'), XLSX);
}));
r.get('/margine-service/export.pdf', ah(async (req, res) => {
  const p = periodoDa(req);
  const d = await margine(p);
  await audit(req, 'MARGINE_SRV_EXPORT', 'margine_service', null, { periodo: p.etichetta, formato: 'PDF' });
  invia(res, await marginePdf(d), nomeFile('Margine_clienti_Service', p, 'pdf'), 'application/pdf');
}));
// Dettaglio del cliente mese per mese (anno intero)
r.get('/margine-service/cliente/:orgId', ah(async (req, res) => {
  let p; try { p = CE.periodo(req.query.anno || new Date().getFullYear(), null); } catch (e) { throw bad(e.message); }   // dettaglio: i 12 mesi (i futuri vuoti)
  const d = await margine(p, Number(req.params.orgId));
  if (!d.clienti.length) throw notFound('Cliente non trovato tra i clienti Service attivi o contrattualizzati');
  res.json({ periodo: p, cliente: d.clienti[0], fonti: d.fonti, avvisi: d.avvisi, impostazioni: d.impostazioni });
}));

// ---------------------------------------------------------------- produzione Service (inserimento manuale, XLSX, stime salvate)
const meseRe = /^\d{4}-(0[1-9]|1[0-2])$/;
const prodSchema = z.object({
  org_id: z.coerce.number().int().positive(),
  mese: z.string().regex(meseRe, 'mese nel formato AAAA-MM'),
  esami: z.coerce.number().int().min(0).max(10_000_000),
  valore: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().min(0).max(999_999_999).nullable()),
  fonte: z.enum(['MANUALE', 'STUDIOLAB', 'STIMA']).default('MANUALE'),
  note: z.preprocess((v) => (v === '' || v === undefined ? null : v), z.string().max(1000).nullable()),
});
async function clienteSrv(orgId) {
  return one(`SELECT v.org_id, o.name FROM public.clienti_attivi_v v JOIN public.organizations o ON o.id = v.org_id WHERE v.linea = 'SRV' AND v.org_id = $1 LIMIT 1`, [orgId]).catch(() => null);
}
async function salvaProduzione(d, userId, righe = null) {
  return one(`INSERT INTO produzione_service (org_id, mese, esami, valore, fonte, righe, note, created_by, updated_by) VALUES ($1, ($2 || '-01')::date, $3, $4, $5, $6, $7, $8, $8)
      ON CONFLICT (org_id, mese) DO UPDATE SET esami = EXCLUDED.esami, valore = EXCLUDED.valore, fonte = EXCLUDED.fonte, righe = EXCLUDED.righe, note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()
      RETURNING id, org_id, to_char(mese, 'YYYY-MM') AS mese, esami, valore, fonte, note, (xmax = 0) AS nuova`,
  [d.org_id, d.mese, d.esami, d.valore, d.fonte, righe ? JSON.stringify(righe) : null, d.note, userId]);
}
r.get('/produzione', ah(async (req, res) => {
  const p = periodoDa(req);
  res.json(await many(`SELECT ps.id, ps.org_id, o.name AS org_name, to_char(ps.mese, 'YYYY-MM') AS mese, ps.esami, ps.valore, ps.fonte, ps.note, jsonb_array_length(coalesce(ps.righe, '[]'::jsonb)) AS righe, ps.updated_at, u.full_name AS updated_by_name
      FROM produzione_service ps JOIN public.organizations o ON o.id = ps.org_id LEFT JOIN users u ON u.id = ps.updated_by
     WHERE ps.mese BETWEEN $1::date AND $2::date ORDER BY ps.mese DESC, lower(o.name)`, [p.da, p.a]));
}));
r.post('/produzione', requireManage, ah(async (req, res) => {
  const d = parse(prodSchema, req.body);
  if (!(await clienteSrv(d.org_id))) throw bad('La Legal entity non è un cliente Service attivo o contrattualizzato (Business Hub)');
  const row = await salvaProduzione(d, req.user.id);
  await audit(req, row.nuova ? 'PRODUZIONE_SRV_CREATE' : 'PRODUZIONE_SRV_UPDATE', 'produzione_service', row.id, d);
  res.status(row.nuova ? 201 : 200).json(row);
}));
r.delete('/produzione/:id', requireManage, ah(async (req, res) => {
  const row = await one('DELETE FROM produzione_service WHERE id = $1 RETURNING id, org_id, mese, esami, valore, fonte', [Number(req.params.id)]);
  if (!row) throw notFound();
  await audit(req, 'PRODUZIONE_SRV_DELETE', 'produzione_service', row.id, row);
  res.json({ ok: true });
}));
// Stime del periodo salvate (fonte STIMA) per i clienti senza produzione salvata: le righe esistenti non si toccano
r.post('/produzione/stime', requireManage, ah(async (req, res) => {
  let p; try { p = CE.periodo(req.body?.anno, req.body?.mese || null, todayRome()); } catch (e) { throw bad(e.message); }
  const s = await caricaService(p);
  const salvate = [];
  for (const c of s.clienti) for (const [mk, m] of Object.entries(c.mesi)) {
    if (!m.produzione || !m.produzione.calcolata) continue;   // solo dove si userebbe la stima calcolata al momento
    const st = m.produzione.dettaglio_stima;
    const row = await one(`INSERT INTO produzione_service (org_id, mese, esami, valore, fonte, note, created_by, updated_by) VALUES ($1, ($2 || '-01')::date, $3, $4, 'STIMA', $5, $6, $6)
        ON CONFLICT (org_id, mese) DO NOTHING RETURNING id`, [c.org_id, mk, m.esami, m.valore_produzione, `Stima: ${String(st?.volumi_giornalieri ?? '').replace('.', ',')} esami al giorno × ${String(st?.giorni_mese ?? '').replace('.', ',')} giorni${st?.prezzo_medio != null ? ` × ${String(st.prezzo_medio).replace('.', ',')} € per esame` : ''} (Business Hub)`, req.user.id]);
    if (row) salvate.push({ org_id: c.org_id, org_name: c.org_name, mese: mk, esami: m.esami, valore: m.valore_produzione });
  }
  await audit(req, 'PRODUZIONE_SRV_STIME', 'produzione_service', null, { periodo: p.etichetta, salvate: salvate.length });
  res.json({ salvate });
}));

// Import da XLSX: una riga per cliente e mese (o per esame: le righe dello stesso cliente e mese si sommano e il dettaglio per codice
// resta per il ricavo a listino). Il cliente si riconosce dal codice StudioLAB (sede SERVICE o account), dalla P.IVA o dal nome.
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SINONIMI = {
  cliente: ['codice cliente', 'cod cliente', 'codice studiolab', 'cliente', 'ragione sociale', 'struttura', 'committente', 'partita iva', 'p iva', 'piva'],
  mese: ['mese', 'periodo', 'competenza', 'data'],
  esami: ['esami', 'n esami', 'numero esami', 'quantita', 'qta', 'prestazioni'],
  valore: ['valore', 'importo', 'totale', 'fatturato', 'valore produzione'],
  codice: ['codice esame', 'cod esame', 'codice prestazione', 'esame codice'],
  descrizione: ['descrizione', 'descrizione esame', 'esame'],
  fonte: ['fonte'],
};
function colonne(head) {
  const m = {};
  head.forEach((h, i) => {
    const n = norm(h);
    for (const [k, syn] of Object.entries(SINONIMI)) if (m[k] == null && syn.includes(n)) { m[k] = i; return; }
  });
  return m;
}
const cella = (v) => (v && typeof v === 'object' && 'result' in v ? v.result : v && typeof v === 'object' && 'text' in v ? v.text : v);
const numero = (v) => { v = cella(v); if (v == null || v === '') return null; if (typeof v === 'number') return v; const s = String(v).replace(/[€\s]/g, ''); const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) ? n : null; };
function meseDa(v, def) {
  v = cella(v);
  if (v instanceof Date) return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}`;
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/-](\d{4})$/); if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, '0')}`;
  const i = CE.MESI_LUNGHI.findIndex((x) => norm(s).startsWith(x)); m = s.match(/(\d{4})/);
  if (i >= 0 && m) return `${m[1]}-${String(i + 1).padStart(2, '0')}`;
  return def || null;
}
r.post('/produzione/import', requireManage, upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('Carica il file XLSX della produzione');
  const prova = String(req.query.prova || req.body?.prova || '') === '1';
  const meseDef = req.body?.mese && meseRe.test(req.body.mese) ? req.body.mese : null;
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.file.buffer); } catch { throw bad('File non leggibile: serve un XLSX'); }
  const ws = wb.worksheets[0];
  if (!ws) throw bad('Il file non ha fogli');
  const righe = []; ws.eachRow({ includeEmpty: false }, (row) => { righe.push(row.values.slice(1)); });
  let hi = righe.findIndex((h) => { const c = colonne(h); return c.cliente != null && (c.esami != null || c.valore != null); });
  if (hi < 0 || hi > 20) throw bad('Intestazioni non riconosciute: servono almeno le colonne "Cliente" (codice StudioLAB, P.IVA o ragione sociale) ed "Esami" o "Valore", più "Mese" se il file ha più mesi');
  const col = colonne(righe[hi]);
  if (col.mese == null && !meseDef) throw bad('Il file non ha la colonna "Mese": indica il mese a cui si riferisce');
  // clienti Service riconoscibili: codici StudioLAB delle sedi SERVICE e degli account, P.IVA e nome
  const clienti = await many(`SELECT v.org_id, o.name, regexp_replace(upper(coalesce(o.vat_number, '')), '[^A-Z0-9]', '', 'g') AS piva FROM public.clienti_attivi_v v JOIN public.organizations o ON o.id = v.org_id WHERE v.linea = 'SRV'`).catch(() => []);
  const codici = new Map();
  for (const s of await many(`SELECT upper(studiolab_code) AS c, organization_id FROM public.sites WHERE kind = 'SERVICE' AND coalesce(studiolab_code, '') <> '' AND organization_id IS NOT NULL`)) codici.set(s.c, s.organization_id);
  const acc = await leggi('business', `SELECT upper(studiolab_code) AS c, organization_id FROM accounts WHERE coalesce(studiolab_code, '') <> ''`);
  for (const a of acc.rows) if (!codici.has(a.c)) codici.set(a.c, a.organization_id);
  const ammessi = new Set(clienti.map((c) => c.org_id));
  const trova = (v) => {
    const s = String(cella(v) ?? '').trim(); if (!s) return null;
    const up = s.toUpperCase();
    if (codici.has(up) && ammessi.has(codici.get(up))) return codici.get(up);
    const piva = up.replace(/[^A-Z0-9]/g, '').replace(/^IT/, '');
    const perIva = clienti.filter((c) => piva.length >= 11 && c.piva.replace(/^IT/, '') === piva);
    if (perIva.length === 1) return perIva[0].org_id;
    const perNome = clienti.filter((c) => norm(c.name) === norm(s));
    return perNome.length === 1 ? perNome[0].org_id : null;
  };
  const gruppi = new Map(); const scartate = [];
  for (let i = hi + 1; i < righe.length; i++) {
    const x = righe[i];
    const raw = x[col.cliente];
    if (raw == null || String(cella(raw)).trim() === '') continue;
    const orgId = trova(raw);
    const mese = col.mese != null ? meseDa(x[col.mese], meseDef) : meseDef;
    const esami = col.esami != null ? numero(x[col.esami]) : null;
    const valore = col.valore != null ? numero(x[col.valore]) : null;
    if (!orgId) { scartate.push({ riga: i + 1, cliente: String(cella(raw)), motivo: 'cliente Service non riconosciuto (codice StudioLAB, P.IVA o ragione sociale)' }); continue; }
    if (!mese || !meseRe.test(mese)) { scartate.push({ riga: i + 1, cliente: String(cella(raw)), motivo: 'mese non leggibile' }); continue; }
    if (esami == null && valore == null) { scartate.push({ riga: i + 1, cliente: String(cella(raw)), motivo: 'né esami né valore' }); continue; }
    const k = `${orgId}|${mese}`;
    if (!gruppi.has(k)) gruppi.set(k, { org_id: orgId, mese, esami: 0, valore: null, righe: [], fonte: null });
    const g = gruppi.get(k);
    g.esami += Math.max(0, Math.round(esami || 0));
    if (valore != null) g.valore = CE.r2((g.valore || 0) + valore);
    const codice = col.codice != null ? String(cella(x[col.codice]) ?? '').trim() : '';
    if (codice) g.righe.push({ codice: codice.toUpperCase(), descrizione: col.descrizione != null ? String(cella(x[col.descrizione]) ?? '') : null, quantita: Math.max(0, Math.round(esami || 0)), valore: valore != null ? CE.r2(valore) : null });
    const f = col.fonte != null ? String(cella(x[col.fonte]) ?? '').trim().toUpperCase() : '';
    if (['MANUALE', 'STUDIOLAB', 'STIMA'].includes(f)) g.fonte = f;
  }
  const nomi = new Map(clienti.map((c) => [c.org_id, c.name]));
  const esito = [...gruppi.values()].map((g) => ({ ...g, org_name: nomi.get(g.org_id), fonte: g.fonte || 'MANUALE', righe_esame: g.righe.length }));
  if (!prova) {
    for (const g of esito) await salvaProduzione({ org_id: g.org_id, mese: g.mese, esami: g.esami, valore: g.valore, fonte: g.fonte, note: `Da file ${req.file.originalname}` }, req.user.id, g.righe.length ? g.righe : null);
    await audit(req, 'PRODUZIONE_SRV_IMPORT', 'produzione_service', null, { file: req.file.originalname, righe: esito.length, scartate: scartate.length });
    await suiteAudit(req, 'PRODUZIONE_SRV_IMPORT', 'produzione_service', null, { file: req.file.originalname, righe: esito.length, scartate: scartate.length });
  }
  res.json({ prova, colonne: Object.fromEntries(Object.entries(col).map(([k, i]) => [k, String(cella(righe[hi][i]) ?? '')])), righe: esito.map(({ righe: _r, ...x }) => x), scartate });
}));

// ---------------------------------------------------------------- costi analitici per esame (Impostazioni)
r.get('/costi-esami', ah(async (_req, res) => {
  const rows = await many('SELECT codice, descrizione, costo, updated_at FROM costi_esami ORDER BY codice LIMIT 5000');
  res.json({ righe: rows, n: rows.length });
}));
r.post('/costi-esami/import', requireAdmin, upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('Carica il file XLSX "costi esami" (colonne: codice, descrizione, costo)');
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(req.file.buffer); } catch { throw bad('File non leggibile: serve un XLSX'); }
  const ws = wb.worksheets[0];
  const righe = []; ws.eachRow({ includeEmpty: false }, (row) => { righe.push(row.values.slice(1)); });
  const hi = righe.findIndex((h) => h.some((x) => ['codice', 'codice esame', 'cod esame'].includes(norm(cella(x)))) && h.some((x) => ['costo', 'costo esame', 'costo unitario', 'costo analitico'].includes(norm(cella(x)))));
  if (hi < 0) throw bad('Intestazioni non riconosciute: servono le colonne "Codice" e "Costo" (e facoltativa "Descrizione")');
  const h = righe[hi].map((x) => norm(cella(x)));
  const ic = h.findIndex((x) => ['codice', 'codice esame', 'cod esame'].includes(x));
  const ik = h.findIndex((x) => ['costo', 'costo esame', 'costo unitario', 'costo analitico'].includes(x));
  const id = h.findIndex((x) => ['descrizione', 'descrizione esame', 'esame'].includes(x));
  let n = 0; const scartate = [];
  for (let i = hi + 1; i < righe.length; i++) {
    const codice = String(cella(righe[i][ic]) ?? '').trim().toUpperCase();
    const costo = numero(righe[i][ik]);
    if (!codice) continue;
    if (costo == null || costo < 0) { scartate.push({ riga: i + 1, codice, motivo: 'costo mancante o non valido' }); continue; }
    await q(`INSERT INTO costi_esami (codice, descrizione, costo, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (codice) DO UPDATE SET descrizione = coalesce(EXCLUDED.descrizione, costi_esami.descrizione), costo = EXCLUDED.costo, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [codice, id >= 0 ? String(cella(righe[i][id]) ?? '').trim() || null : null, costo, req.user.id]);
    n++;
  }
  await audit(req, 'COSTI_ESAMI_IMPORT', 'costi_esami', null, { file: req.file.originalname, righe: n, scartate: scartate.length });
  res.json({ caricati: n, scartate });
}));

// ---------------------------------------------------------------- elenchi per i selettori delle istanze
r.get('/sedi', ah(async (_req, res) => {
  res.json(await many(`SELECT id, code, name, kind, active FROM public.sites WHERE kind <> 'SERVICE' ORDER BY active DESC, sort_order NULLS LAST, name`));
}));
r.get('/clienti', ah(async (_req, res) => {
  const rows = await many(`SELECT v.org_id AS id, o.name, string_agg(DISTINCT v.linea, ', ') AS linee, string_agg(DISTINCT v.livello, ', ') AS livelli
      FROM public.clienti_attivi_v v JOIN public.organizations o ON o.id = v.org_id GROUP BY v.org_id, o.name ORDER BY lower(o.name)`).catch(() => []);
  res.json(rows);
}));
r.get('/impostazioni', ah(async (_req, res) => res.json(await impostazioniControllo())));

export default r;
