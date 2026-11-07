// Business Hub · Listino StudioLAB e Offerta economica (route montate sotto /api/business/hub). Docs: docs/BUSINESS_HUB.md, "Processo
// Service". Lettura per tutti i profili del modulo; caricamento, scelta della versione corrente e generazione dell'offerta per chi
// gestisce la linea (canEditKind). Il caricamento passa sempre dall'anteprima: prima "anteprima" (nessuna scrittura), poi "salva".
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { ah, bad, forbidden, notFound, audit, parse, todayRome } from '../lib/util.js';
import { canEditKind, getSettings } from '../lib/rules.js';
import { requireAdmin } from '../lib/access.js';
import { storeBuffer, readBuffer } from '../lib/storage.js';
import { LINEE } from '../lib/hub.js';
import { leggiListino, differenze, versioneCorrente, CAMPI_KEYS } from '../lib/listino.js';
import { generaOffertaEconomica, nomeFileOfferta } from '../lib/offertaEconomica.js';
import { addGiorni } from '../lib/pacchetto.js';
import { loadAccount, addActivity } from './hub.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });
export const CHIAVE_MAPPING = 'listino.mapping';

function richiedi(req, a) { if (!canEditKind(req.user, a.linea)) throw forbidden(`Il listino lo gestisce chi segue la linea ${LINEE[a.linea].label}`); }
async function mappingSalvato() {
  const x = await one('SELECT value FROM app_settings WHERE key=$1', [CHIAVE_MAPPING]);
  try { return x ? JSON.parse(x.value) : null; } catch { return null; }
}
const versioniDi = (accountId) => many(`SELECT l.id, l.versione, l.filename, l.documento_id, l.note, l.riepilogo, l.caricato_at, u.full_name AS caricato_da, l.offerta_documento_id, l.offerta_at, l.offerta_dati,
    d.filename AS offerta_filename, d.size AS offerta_size,
    CASE WHEN l.differenze IS NULL THEN NULL ELSE jsonb_build_object('aggiunte', jsonb_array_length(l.differenze->'aggiunte'), 'tolte', jsonb_array_length(l.differenze->'tolte'),
      'cambiate', jsonb_array_length(l.differenze->'cambiate'), 'invariate', l.differenze->'invariate', 'variazione_sconto', l.differenze->'variazione_sconto') END AS diff
  FROM listini l LEFT JOIN users u ON u.id=l.caricato_by LEFT JOIN documenti d ON d.id=l.offerta_documento_id WHERE l.account_id=$1 ORDER BY l.versione DESC`, [accountId]);

/** Listino corrente dell'account (riga completa) o null. */
export async function listinoCorrente(a) {
  const v = await many('SELECT id, versione FROM listini WHERE account_id=$1', [a.id]);
  const c = versioneCorrente(v, a.listino_corrente_id);
  return c ? one('SELECT * FROM listini WHERE id=$1', [c.id]) : null;
}

r.get('/accounts/:id/listini', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  const versioni = await versioniDi(a.id);
  const cor = versioneCorrente(versioni, a.listino_corrente_id);
  const s = await getSettings();
  const ext = await one('SELECT pay_terms FROM org_ext WHERE org_id=$1', [a.organization_id]);
  res.json({ versioni, corrente_id: cor?.id || null, scelta_manuale: Boolean(a.listino_corrente_id), puo_modificare: canEditKind(req.user, a.linea), mapping: await mappingSalvato(),
    predefiniti: { validita: addGiorni(todayRome(), Number(s.hub_offerta_validita_giorni) || 60), condizioni: ext?.pay_terms || s.payment_terms_default || '' } });
}));

r.get('/listini/:id', ah(async (req, res) => {
  const l = await one('SELECT l.*, u.full_name AS caricato_da FROM listini l LEFT JOIN users u ON u.id=l.caricato_by WHERE l.id=$1', [Number(req.params.id)]);
  if (!l) throw notFound('Listino non trovato');
  res.json(l);
}));

// Lettura del file con il mapping (riconosciuto, salvato o scelto a video) e confronto con la versione corrente: nessuna scrittura
async function leggi(req, a) {
  if (!req.file) throw bad('Carica il file Excel del listino esportato da StudioLAB');
  return leggiBuffer(req, a, req.file.buffer, req.file.originalname);
}
async function leggiBuffer(req, a, buffer, filename) {
  let forzato = null;
  if (req.body.mapping) {
    try { forzato = JSON.parse(req.body.mapping); } catch { throw bad('Mapping non valido'); }
    forzato = Object.fromEntries(Object.entries(forzato || {}).filter(([k, v]) => CAMPI_KEYS.includes(k) && v !== '' && v != null).map(([k, v]) => [k, Number(v)]));
  }
  const out = await leggiListino(buffer, filename, { mappingSalvato: await mappingSalvato(), mappingForzato: forzato, foglio: req.body.foglio || null });
  const prec = await listinoCorrente(a);
  const diff = prec && out.righe.length ? differenze(prec.righe, out.righe) : null;
  return { out, prec, diff };
}

r.post('/accounts/:id/listini/anteprima', upload.single('file'), ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiedi(req, a);
  const { out, prec, diff } = await leggi(req, a);
  const prossima = Number((await one('SELECT coalesce(max(versione),0)+1 AS v FROM listini WHERE account_id=$1', [a.id])).v);
  res.json({ ...out, righe: out.righe.slice(0, 500), righe_totali: out.righe.length, versione: prossima, precedente: prec ? { id: prec.id, versione: prec.versione, riepilogo: prec.riepilogo } : null, differenze: diff });
}));

// Importa come nuova versione l'Excel del listino allegato al contratto della linea (travaso dai contratti, 07/11/2026)
r.post('/accounts/:id/listini/da-contratto/:fileId', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiedi(req, a);
  const f = await one(`SELECT f.id, f.filename, f.mime, f.data, f.blob_path, c.protocol FROM contract_files f JOIN contracts c ON c.id=f.contract_id WHERE f.id=$1 AND c.org_id=$2 AND c.kind=$3`, [req.params.fileId, a.organization_id, a.linea]);
  if (!f) throw notFound('File del contratto non trovato per questo account');
  if (!/\.xlsx?$/i.test(f.filename)) throw bad('Il file allegato al contratto non è un Excel');
  const buffer = await readBuffer(f);
  if (!buffer) throw bad('Contenuto del file non disponibile');
  req.file = { buffer, originalname: f.filename, mimetype: f.mime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  req.body = { ...(req.body || {}), note: `Importato dal contratto ${f.protocol || ''}`.trim() };
  await salvaListino(req, res, a);
}));

r.post('/accounts/:id/listini', upload.single('file'), ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiedi(req, a);
  await salvaListino(req, res, a);
}));
async function salvaListino(req, res, a) {
  const { out, prec, diff } = await leggi(req, a);
  if (out.mancanti.length) throw bad(`Colonne non riconosciute: ${out.mancanti.join(', ')}. Indica a video quale colonna è la descrizione e quale il prezzo di listino`);
  if (!out.righe.length) throw bad('Nessuna riga di esame letta dal file');
  const note = String(req.body.note || '').trim().slice(0, 1000) || null;
  // il mapping scelto a video vale anche per i caricamenti successivi (stesso formato di StudioLAB)
  if (req.body.mapping && req.body.salva_mapping !== 'false') {
    await q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [CHIAVE_MAPPING, JSON.stringify({ mapping: out.mapping, intestazioni: out.intestazioni, salvato_at: new Date().toISOString() })]);
  }
  const st = await storeBuffer('hub', req.file.originalname, req.file.mimetype, req.file.buffer);
  const versione = Number((await one('SELECT coalesce(max(versione),0)+1 AS v FROM listini WHERE account_id=$1', [a.id])).v);
  const doc = await one(`INSERT INTO documenti (account_id, categoria, filename, mime, size, sha256, data, blob_path, uploaded_by, etichetta) VALUES ($1,'LISTINO',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [a.id, req.file.originalname, req.file.mimetype || 'application/octet-stream', st.size, st.sha256, st.data, st.blob_path, req.user.id, `Listino StudioLAB v${versione}`]);
  const row = await one(`INSERT INTO listini (account_id, versione, filename, documento_id, note, mapping, intestazioni, righe, riepilogo, differenze, caricato_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [a.id, versione, req.file.originalname, doc.id, note, JSON.stringify(out.mapping), JSON.stringify(out.intestazioni), JSON.stringify(out.righe), JSON.stringify(out.riepilogo), diff ? JSON.stringify(diff) : null, req.user.id]);
  // una nuova versione diventa la corrente (salvo scelta successiva); lo sconto medio dell'account segue il listino corrente
  await q('UPDATE accounts SET listino_corrente_id=NULL, sconto_medio=$2, updated_at=now() WHERE id=$1', [a.id, -Number(out.riepilogo.sconto_medio || 0) / 100]);
  const testo = [`${out.riepilogo.esami} esami, sconto medio ${out.riepilogo.sconto_medio}% sul listino (ponderato).`, note ? `Nota: ${note}` : null,
    diff ? `Rispetto alla v${prec.versione}: ${diff.cambiate.length} righe cambiate, ${diff.aggiunte.length} aggiunte, ${diff.tolte.length} tolte; sconto medio ${diff.sconto_medio_prima}% → ${diff.sconto_medio_dopo}%.` : null,
    'Lo sconto medio dell\'account è stato aggiornato dal listino.'].filter(Boolean).join('\n');
  const act = await addActivity(a.id, { tipo: 'LISTINO', oggetto: `Listino StudioLAB v${versione} caricato`, testo, dati: { listino_id: row.id, versione, documento_id: doc.id } }, req.user.id);
  await q('UPDATE documenti SET activity_id=$2 WHERE id=$1', [doc.id, act.id]);
  await audit(req, 'HUB_LISTINO', 'account', a.id, { versione, esami: out.riepilogo.esami });
  res.status(201).json({ id: row.id, versione, riepilogo: out.riepilogo, differenze: diff });
}

r.put('/accounts/:id/listino-corrente', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiedi(req, a);
  const d = parse(z.object({ listino_id: z.number().int().positive().nullable() }), req.body || {});
  if (d.listino_id && !(await one('SELECT 1 FROM listini WHERE id=$1 AND account_id=$2', [d.listino_id, a.id]))) throw bad('Versione non di questo account');
  await q('UPDATE accounts SET listino_corrente_id=$2, updated_at=now() WHERE id=$1', [a.id, d.listino_id]);
  const cur = await listinoCorrente({ ...a, listino_corrente_id: d.listino_id });
  if (cur) await q('UPDATE accounts SET sconto_medio=$2 WHERE id=$1', [a.id, -Number(cur.riepilogo?.sconto_medio || 0) / 100]);
  await addActivity(a.id, { tipo: 'SISTEMA', oggetto: `Listino corrente: v${cur?.versione || '–'}${d.listino_id ? ' (scelta manuale)' : ' (l\'ultima)'}` }, req.user.id);
  res.json({ ok: true });
}));

// Offerta economica in PDF da una versione del listino: nei Documenti dell'account (categoria OFFERTA_ECONOMICA)
const offertaSchema = z.object({
  data: z.preprocess((v) => (v === '' || v == null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()).optional(),
  validita: z.preprocess((v) => (v === '' || v == null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()).optional(),
  condizioni: z.string().trim().max(500).optional(), note: z.string().trim().max(3000).optional(), contatto_id: z.number().int().positive().nullable().optional(),
});
export async function creaOfferta(a, listinoId, opz, userId) {
  const l = await one('SELECT * FROM listini WHERE id=$1 AND account_id=$2', [listinoId, a.id]);
  if (!l) throw notFound('Versione del listino non trovata');
  const c = opz.contatto_id ? await one('SELECT nome FROM contatti WHERE id=$1 AND account_id=$2', [opz.contatto_id, a.id]) : null;
  const data = opz.data || todayRome();
  const t0 = Date.now();
  const g = await generaOffertaEconomica(a, l, { data, validita: opz.validita || null, condizioni: opz.condizioni || null, note: opz.note || null, destinatario: c?.nome || null });
  const filename = nomeFileOfferta(a.org_name, l.versione, data);
  const st = await storeBuffer('hub', filename, 'application/pdf', g.pdf);
  const doc = await one(`INSERT INTO documenti (account_id, categoria, filename, mime, size, sha256, data, blob_path, uploaded_by, etichetta) VALUES ($1,'OFFERTA_ECONOMICA',$2,'application/pdf',$3,$4,$5,$6,$7,$8) RETURNING id`,
    [a.id, filename, st.size, st.sha256, st.data, st.blob_path, userId, `Offerta economica v${l.versione}`]);
  await q('UPDATE listini SET offerta_documento_id=$2, offerta_at=now(), offerta_dati=$3 WHERE id=$1', [l.id, doc.id, JSON.stringify(g.dati)]);
  const act = await addActivity(a.id, { tipo: 'OFFERTA_ECONOMICA', oggetto: `Offerta economica v${l.versione} generata (${g.pagine} pagine)`,
    testo: [`${l.riepilogo.esami} esami, sconto medio ${l.riepilogo.sconto_medio}%.`, g.dati.validita ? `Valida fino al ${g.dati.validita}.` : null, g.dati.condizioni ? `Condizioni di pagamento: ${g.dati.condizioni}.` : null].filter(Boolean).join('\n'),
    dati: { listino_id: l.id, versione: l.versione, documento_id: doc.id } }, userId);
  await q('UPDATE documenti SET activity_id=$2 WHERE id=$1', [doc.id, act.id]);
  console.log(`[business] offerta economica account ${a.id} v${l.versione}: ${g.pagine} pagine in ${Date.now() - t0} ms`);
  return { documento_id: doc.id, filename, pagine: g.pagine, bytes: g.pdf.length, versione: l.versione };
}
r.post('/listini/:id/offerta', ah(async (req, res) => {
  const l = await one('SELECT account_id FROM listini WHERE id=$1', [Number(req.params.id)]);
  if (!l) throw notFound('Listino non trovato');
  const a = await loadAccount(l.account_id);
  richiedi(req, a);
  const d = parse(offertaSchema, req.body || {});
  const out = await creaOfferta(a, Number(req.params.id), d, req.user.id);
  await audit(req, 'HUB_OFFERTA_ECONOMICA', 'account', a.id, { versione: out.versione, pagine: out.pagine });
  res.status(201).json(out);
}));

// Mapping salvato delle colonne (Impostazioni): lettura e azzeramento
r.get('/listino/mapping', ah(async (_req, res) => res.json(await mappingSalvato())));
r.delete('/listino/mapping', requireAdmin, ah(async (req, res) => {
  await q('DELETE FROM app_settings WHERE key=$1', [CHIAVE_MAPPING]);
  await audit(req, 'HUB_LISTINO_MAPPING_RESET', 'settings', null, {});
  res.json({ ok: true });
}));

export default r;
