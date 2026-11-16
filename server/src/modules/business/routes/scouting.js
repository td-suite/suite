// Business Hub · Ricerca prospect (montata sotto /api/business/scouting). Lettura per tutti i profili del modulo; ricerche, profili e
// promozione in pipeline per chi gestisce la linea; attivazione dei segnali per l'Admin del modulo. Docs: docs/BUSINESS_SCOUTING.md.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, forbidden, notFound, audit, parse } from '../lib/util.js';
import { canEditKind } from '../lib/rules.js';
import { isAdmin } from '../lib/access.js';
import { LINEE } from '../lib/hub.js';
import { PROVINCE, AVVISI_FONTE } from '../lib/scouting/scoperta.js';
import { CATEGORIE, punteggio } from '../lib/scouting/fit.js';
import { CATALOGO } from '../lib/scouting/segnali.js';
import { RUOLI } from '../lib/scouting/persone.js';
import { normUrl, dominioDi } from '../lib/scouting/web.js';
import { verificaPiva } from '../lib/scouting/vies.js';
import * as S from '../lib/scouting/store.js';
import multer from 'multer';
import { ATECO, stimaRegistro } from '../lib/scouting/registro.js';
import { cercaGoogle } from '../lib/scouting/google.js';
import { connectorSync } from '../../../lib/connectors.js';
import { FONTI, convertitore, scaricaFonte, decodifica, leggiCsv, candidatiDaElenco } from '../lib/scouting/fonti.js';
import { loadAccount } from './hub.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 1 } });
const LINEA = z.enum(['SRV', 'PP', 'MDL']);
const richiediLinea = (req, linea) => { if (!canEditKind(req.user, linea)) throw forbidden(`Non gestisci la linea ${LINEE[linea]?.label || linea}`); };
const candidato = async (id) => { const c = await one('SELECT * FROM scout_candidati WHERE id=$1', [Number(id)]); if (!c) throw notFound('Candidato non trovato'); return c; };

r.get('/catalogo', ah(async (req, res) => {
  const linea = LINEA.safeParse(req.query.linea).success ? req.query.linea : 'SRV';
  res.json({
    linea, province: PROVINCE, categorie: Object.entries(CATEGORIE).filter(([k, v]) => v.linee.includes(linea) && k !== 'ALTRO').map(([k, v]) => ({ key: k, etichetta: v.etichetta, avviso: AVVISI_FONTE[k] || null })),
    segnali: await S.catalogo(), ruoli: RUOLI.map((x) => ({ ruolo: x.ruolo, etichetta: x.etichetta })), impostazioni: await S.impostazioni(), puo_scrivere: canEditKind(req.user, linea), admin: isAdmin(req.user),
  });
}));
r.put('/segnali', ah(async (req, res) => {
  if (!isAdmin(req.user)) throw forbidden('Riservato all\'amministratore del modulo');
  const b = parse(z.object({ attivi: z.record(z.boolean()).optional(), fornitori: z.array(z.string().trim().min(3).max(80)).max(60).optional(), max_persone: z.number().int().min(1).max(6).optional() }), req.body);
  const metti = (k, v) => q('INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, v]);
  if (b.attivi) await metti('scout_segnali', JSON.stringify(Object.fromEntries(Object.entries(b.attivi).filter(([k]) => CATALOGO.some((s) => s.key === k)))));
  if (b.fornitori) await metti('scout_fornitori', b.fornitori.join('\n'));
  if (b.max_persone) await metti('scout_max_persone', String(b.max_persone));
  await audit(req, 'HUB_SCOUT_IMPOSTAZIONI', 'scouting', null, { attivi: b.attivi ? Object.keys(b.attivi).filter((k) => b.attivi[k] === false) : undefined, fornitori: b.fornitori?.length });
  res.json({ ok: true, segnali: await S.catalogo(), impostazioni: await S.impostazioni() });
}));

// ---------------- Scoperta ----------------
r.get('/ricerche', ah(async (req, res) => { await S.chiudiInterrotte(); res.json(await many(`SELECT r.*, u.full_name AS creata_da FROM scout_ricerche r LEFT JOIN users u ON u.id=r.created_by WHERE ($1::text IS NULL OR r.linea=$1) ORDER BY r.id DESC LIMIT 30`, [req.query.linea || null])); }));
r.post('/ricerche', ah(async (req, res) => {
  const b = parse(z.object({ linea: LINEA, province: z.array(z.string()).min(1).max(10), categorie: z.array(z.string()).min(1).max(12) }), req.body);
  richiediLinea(req, b.linea);
  if (b.province.some((p) => !PROVINCE[p])) throw bad('Provincia non prevista');
  if (b.categorie.some((c) => !CATEGORIE[c]?.linee.includes(b.linea))) throw bad('Tipologia non prevista per questa linea');
  await S.chiudiInterrotte();
  if (await one(`SELECT 1 FROM scout_ricerche WHERE stato='IN_CORSO'`)) throw bad('C\'è già una ricerca in corso: attendi che finisca o annullala');
  const { ricerca } = await S.avviaRicerca({ ...b, userId: req.user.id });
  await audit(req, 'HUB_SCOUT_RICERCA', 'scouting', ricerca.id, { linea: b.linea, province: b.province, categorie: b.categorie });
  res.status(202).json(ricerca);
}));

r.post('/ricerche/:id/annulla', ah(async (req, res) => {
  const x = await one('SELECT * FROM scout_ricerche WHERE id=$1', [Number(req.params.id)]);
  if (!x) throw notFound('Ricerca non trovata');
  richiediLinea(req, x.linea);
  await q(`UPDATE scout_ricerche SET stato='ANNULLATA', avanzamento=NULL, finita_at=now() WHERE id=$1 AND stato='IN_CORSO'`, [x.id]);
  res.json({ ok: true });
}));

// ---------------- Fonti ufficiali (Ministero della Salute) ed elenchi da file ----------------
r.get('/fonti', ah(async (req, res) => {
  const linea = LINEA.safeParse(req.query.linea).success ? req.query.linea : 'SRV';
  const ultime = await many(`SELECT DISTINCT ON (avvisi_chiave) * FROM (SELECT r.*, split_part(r.fonte, ':', 2) AS avvisi_chiave FROM scout_ricerche r WHERE r.linea=$1 AND r.fonte LIKE 'MINISTERO:%' AND r.stato='FATTA') x ORDER BY avvisi_chiave, id DESC`, [linea]);
  res.json(Object.entries(FONTI).filter(([, f]) => f.linee.includes(linea)).map(([k, f]) => ({ chiave: k, ...f, ultimo: ultime.find((u) => u.avvisi_chiave === k) || null })));
}));
// scarica dal sito del Ministero (se il server lo raggiunge) oppure riceve il file scaricato a mano
r.post('/fonti/:chiave', upload.single('file'), ah(async (req, res) => {
  const k = String(req.params.chiave).toUpperCase(); const f = FONTI[k];
  if (!f) throw notFound('Fonte non prevista');
  const linea = LINEA.parse(req.body.linea);
  richiediLinea(req, linea);
  if (!f.linee.includes(linea)) throw bad('Questa fonte non riguarda la linea scelta');
  const province = String(req.body.province || '').split(',').filter((p) => PROVINCE[p]);
  let testo; let file;
  if (req.file) { testo = decodifica(req.file.buffer); file = req.file.originalname; } else {
    try { ({ testo, file } = await scaricaFonte(k)); } catch (e) { throw Object.assign(bad(e.message), { code: 'FONTE_NON_RAGGIUNGIBILE' }); }
  }
  let candidati;
  try { candidati = convertitore[k](testo, { province: province.length ? province : null }); } catch (e) { throw bad(e.message); }
  if (!candidati.length) throw bad('Nel file non ci sono strutture della Toscana per le province scelte');
  const ric = await S.registraElenco({ linea, fonte: `MINISTERO:${k}`, etichetta: `${f.ente}, ${f.etichetta}`, candidati, userId: req.user.id });
  await audit(req, 'HUB_SCOUT_FONTE', 'scouting', ric.id, { fonte: k, file, trovati: ric.trovati, nuovi: ric.nuovi, da_file: Boolean(req.file) });
  res.status(201).json({ ...ric, file });
}));
r.post('/elenco', upload.single('file'), ah(async (req, res) => {
  const linea = LINEA.parse(req.body.linea);
  richiediLinea(req, linea);
  if (!req.file) throw bad('Scegli il file');
  const cat = CATEGORIE[req.body.categoria]?.linee.includes(linea) ? req.body.categoria : (linea === 'MDL' ? 'AZIENDA' : 'ALTRO');
  let righe;
  if (/\.xlsx$/i.test(req.file.originalname)) {
    const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(req.file.buffer); } catch { throw bad('Il file Excel non si apre'); }
    const ws = wb.worksheets[0]; righe = [];
    ws.eachRow((row) => righe.push(row.values.slice(1).map((v) => (v == null ? '' : typeof v === 'object' ? String(v.text ?? v.result ?? v.hyperlink ?? '') : String(v)))));
  } else if (/\.(csv|txt)$/i.test(req.file.originalname)) righe = leggiCsv(decodifica(req.file.buffer));
  else throw bad('Formati accettati: CSV ed Excel (.xlsx)');
  let candidati;
  try { candidati = candidatiDaElenco(righe, { categoria: cat }); } catch (e) { throw bad(e.message); }
  if (!candidati.length) throw bad('Nessuna riga con un nome');
  if (candidati.length > 5000) throw bad('Al massimo 5.000 righe per file');
  const ric = await S.registraElenco({ linea, fonte: 'ELENCO', etichetta: `File ${req.file.originalname}`.slice(0, 80), candidati, userId: req.user.id });
  await audit(req, 'HUB_SCOUT_ELENCO', 'scouting', ric.id, { file: req.file.originalname, trovati: ric.trovati, nuovi: ric.nuovi });
  res.status(201).json(ric);
}));

// ---------------- Registro imprese (Openapi, a pagamento), Google Places (dal vivo), OpenStreetMap (raccolta notturna) ----------------
r.get('/sorgenti', ah(async (req, res) => {
  const o = connectorSync('OPENAPI'); const g = connectorSync('GOOGLE');
  res.json({ registro: { attivo: Boolean(o.active && o.credentials.api_key), prova: /test\./.test(String(o.base_url || '')), max: Number(o.settings.max_imprese) || 300, ateco: ATECO },
    google: { attivo: Boolean(g.credentials.api_key) }, osm: await S.statoOsm() });
}));
const registroSchema = z.object({ linea: LINEA, province: z.array(z.string()).min(1).max(10), codici: z.array(z.string().trim().regex(/^[0-9A-Za-z.]{2,8}$/, 'codice ATECO non valido')).min(1).max(8),
  min_dipendenti: z.number().int().min(1).max(100000).nullable().optional(), categoria: z.string().optional() });
r.post('/registro/stima', ah(async (req, res) => {
  const b = parse(registroSchema, req.body);
  richiediLinea(req, b.linea);
  if (b.province.some((p) => !PROVINCE[p])) throw bad('Provincia non prevista');
  res.json(await stimaRegistro({ province: b.province, codici: b.codici, minEmployees: b.min_dipendenti || null }));
}));
// la ricerca vera costa: parte solo con conferma esplicita ("confermo": true) dopo aver visto la stima
r.post('/registro/cerca', ah(async (req, res) => {
  const b = parse(registroSchema.extend({ confermo: z.literal(true, { errorMap: () => ({ message: 'Conferma la spesa prima di scaricare' }) }) }), req.body);
  richiediLinea(req, b.linea);
  if (b.province.some((p) => !PROVINCE[p])) throw bad('Provincia non prevista');
  await S.chiudiInterrotte();
  if (await one(`SELECT 1 FROM scout_ricerche WHERE stato='IN_CORSO'`)) throw bad('C\'è già una ricerca in corso: attendi che finisca o annullala');
  const max = Number(connectorSync('OPENAPI').settings.max_imprese) || 300;
  const cat = CATEGORIE[b.categoria]?.linee.includes(b.linea) ? b.categoria : null;
  const { ricerca } = await S.avviaRegistro({ linea: b.linea, province: b.province, codici: b.codici, minEmployees: b.min_dipendenti || null, max, categoria: cat, userId: req.user.id });
  await audit(req, 'HUB_SCOUT_REGISTRO', 'scouting', ricerca.id, { linea: b.linea, province: b.province, codici: b.codici, min_dipendenti: b.min_dipendenti || null, max });
  res.status(202).json(ricerca);
}));
r.post('/google/cerca', ah(async (req, res) => {
  const b = parse(z.object({ linea: LINEA, testo: z.string().trim().min(3).max(120), provincia: z.string().optional().nullable() }), req.body);
  richiediLinea(req, b.linea);
  const out = await cercaGoogle(b.testo, { provincia: b.provincia && PROVINCE[b.provincia] ? b.provincia : null });
  // quali sono già in elenco (per dominio o per identificativo): si dice, senza salvare nient'altro
  const noti = new Set((await many(`SELECT fonte_ref FROM scout_candidati WHERE linea=$1 AND fonte='GOOGLE' AND fonte_ref = ANY($2::text[])`, [b.linea, out.luoghi.map((l) => l.id)])).map((x) => x.fonte_ref));
  await audit(req, 'HUB_SCOUT_GOOGLE', 'scouting', null, { testo: b.testo, provincia: b.provincia || null, risultati: out.luoghi.length });
  res.json({ ...out, luoghi: out.luoghi.map((l) => ({ ...l, gia: noti.has(l.id) })) });
}));
r.post('/google/aggiungi', ah(async (req, res) => {
  const b = parse(z.object({ linea: LINEA, categoria: z.string().optional(), luoghi: z.array(z.object({ id: z.string().min(5).max(300), sito: z.string().min(4).max(500) })).min(1).max(60) }), req.body);
  richiediLinea(req, b.linea);
  const cat = CATEGORIE[b.categoria]?.linee.includes(b.linea) ? b.categoria : (b.linea === 'MDL' ? 'AZIENDA' : 'ALTRO');
  let nuovi = 0; let gia = 0;
  for (const l of b.luoghi) { const x = await S.aggiungiDaGoogle({ linea: b.linea, placeId: l.id, sito: l.sito, categoria: cat, userId: req.user.id }).catch(() => null); if (x?.gia) gia += 1; else if (x) nuovi += 1; }
  res.status(201).json({ nuovi, gia, coda: S.statoCoda() });
}));
r.post('/osm/raccogli', ah(async (req, res) => {
  if (!isAdmin(req.user)) throw forbidden('Riservato all\'amministratore del modulo');
  S.raccoltaOsm({ massimo: 8 }).catch(() => {});
  res.status(202).json({ ok: true });
}));

// ---------------- Candidati e coorti ----------------
r.get('/candidati', ah(async (req, res) => {
  const P = []; const w = [`c.fonte <> 'ACCOUNT'`];
  const add = (v) => { P.push(v); return `$${P.length}`; };
  if (LINEA.safeParse(req.query.linea).success) w.push(`c.linea = ${add(req.query.linea)}`);
  const stati = String(req.query.stato || 'NUOVO,PROFILATO').split(',').filter((x) => ['NUOVO', 'PROFILATO', 'SCARTATO', 'PROMOSSO'].includes(x));
  if (stati.length) w.push(`c.stato = ANY(${add(stati)}::text[])`);
  if (req.query.provincia) w.push(`c.provincia = ${add(String(req.query.provincia))}`);
  if (req.query.categoria) w.push(`c.categoria = ${add(String(req.query.categoria))}`);
  if (req.query.ricerca) w.push(`c.ricerca_id = ${add(Number(req.query.ricerca))}`);
  if (req.query.anagrafica === 'nuovi') w.push('c.organization_id IS NULL');
  if (req.query.anagrafica === 'noti') w.push('c.organization_id IS NOT NULL');
  if (req.query.sito === 'si') w.push('c.sito IS NOT NULL');
  if (req.query.pubblici !== 'si') w.push(`coalesce((c.tags->>'pubblico')::boolean, false) = false`);
  // coorte: deve avere / non deve avere (chiavi del catalogo)
  const chiavi = (s) => String(s || '').split(',').filter((k) => CATALOGO.some((x) => x.key === k));
  for (const k of chiavi(req.query.con)) w.push(`c.segnali ? ${add(k)}`);
  for (const k of chiavi(req.query.senza)) w.push(`NOT (c.segnali ? ${add(k)})`);
  if (req.query.min) w.push(`coalesce(c.punteggio,0) >= ${add(Number(req.query.min) || 0)}`);
  if (req.query.q) w.push(`(c.nome || ' ' || coalesce(c.comune,'') || ' ' || coalesce(c.operatore,'') || ' ' || coalesce(c.dominio,'')) ILIKE ${add(`%${String(req.query.q).trim()}%`)}`);
  const dove = w.join(' AND ');
  const righe = await many(`SELECT c.id, c.linea, c.fonte, c.nome, c.categoria, c.comune, c.provincia, c.indirizzo, c.telefono, c.email, c.sito, c.dominio, c.piva, c.operatore, c.stato, c.segnali, c.punteggio, c.profilato_at, c.errore_profilo,
      c.organization_id, c.account_id, c.abbinato_come, o.name AS org_name, (c.tags->>'pubblico')::boolean AS pubblico,
      (SELECT count(*)::int FROM scout_persone p WHERE p.candidato_id=c.id) AS persone
    FROM scout_candidati c LEFT JOIN public.organizations o ON o.id=c.organization_id WHERE ${dove} ORDER BY c.punteggio DESC NULLS LAST, c.nome LIMIT 400`, P);
  const tot = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE c.profilato_at IS NOT NULL)::int AS profilati, count(*) FILTER (WHERE c.sito IS NOT NULL)::int AS con_sito FROM scout_candidati c WHERE ${dove}`, P);
  res.json({ righe, totale: tot.n, profilati: tot.profilati, con_sito: tot.con_sito, coda: S.statoCoda() });
}));
r.post('/candidati', ah(async (req, res) => {
  const b = parse(z.object({ linea: LINEA, nome: z.string().trim().min(2).max(200), sito: z.string().trim().max(300).optional().nullable(), categoria: z.string().optional(), comune: z.string().trim().max(120).optional().nullable(),
    provincia: z.string().trim().max(2).optional().nullable() }), req.body);
  richiediLinea(req, b.linea);
  const sito = b.sito ? normUrl(b.sito) : null;
  if (b.sito && !sito) throw bad('Sito non valido');
  const rif = (sito ? dominioDi(sito) : b.nome.toLowerCase()).slice(0, 200);
  const cat = CATEGORIE[b.categoria] ? b.categoria : (b.linea === 'MDL' ? 'AZIENDA' : 'ALTRO');
  const m = await S.abbina({ nome: b.nome, dominio: sito ? dominioDi(sito) : null, linea: b.linea });
  const row = await one(`INSERT INTO scout_candidati (linea, fonte, fonte_ref, nome, categoria, comune, provincia, sito, dominio, organization_id, account_id, abbinato_come, segnali, punteggio)
    VALUES ($1,'MANUALE',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (linea, fonte, fonte_ref) DO UPDATE SET nome=EXCLUDED.nome, sito=EXCLUDED.sito, updated_at=now() RETURNING id`,
  [b.linea, rif, b.nome, cat, b.comune || null, b.provincia ? b.provincia.toUpperCase() : null, sito, sito ? dominioDi(sito) : null, m.organization_id, m.account_id, m.come,
    JSON.stringify(sito ? {} : { SENZA_SITO: { valore: true, evidenza: 'Inserito a mano senza sito', url: null } }), punteggio({ categoria: cat, segnali: {} }, b.linea).punteggio]);
  if (sito) S.accoda([row.id]);
  await audit(req, 'HUB_SCOUT_CANDIDATO', 'scouting', row.id, { nome: b.nome, sito });
  res.status(201).json({ id: row.id, coda: S.statoCoda() });
}));
r.post('/candidati/profila', ah(async (req, res) => {
  const b = parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(200) }), req.body);
  const righe = await many(`SELECT id, linea FROM scout_candidati WHERE id = ANY($1::int[]) AND sito IS NOT NULL`, [b.ids]);
  for (const l of new Set(righe.map((x) => x.linea))) richiediLinea(req, l);
  res.status(202).json({ accodati: righe.length, senza_sito: b.ids.length - righe.length, coda: S.accoda(righe.map((x) => x.id)) });
}));
r.get('/coda', ah(async (_req, res) => res.json(S.statoCoda())));
r.get('/candidati/:id', ah(async (req, res) => {
  const c = await candidato(req.params.id);
  const persone = await many('SELECT * FROM scout_persone WHERE candidato_id=$1 ORDER BY rango, id', [c.id]);
  const org = c.organization_id ? await one('SELECT id, name, vat_number, city, province FROM public.organizations WHERE id=$1', [c.organization_id]) : null;
  res.json({ candidato: c, persone, org, fit: punteggio(c, c.linea) });
}));
r.put('/candidati/:id', ah(async (req, res) => {
  const c = await candidato(req.params.id);
  richiediLinea(req, c.linea);
  const b = parse(z.object({ stato: z.enum(['NUOVO', 'SCARTATO']).optional(), motivo: z.string().trim().max(300).optional().nullable(), sito: z.string().trim().max(300).optional().nullable(), categoria: z.string().optional() }), req.body);
  if (b.sito !== undefined) {
    const sito = b.sito ? normUrl(b.sito) : null;
    if (b.sito && !sito) throw bad('Sito non valido');
    await q(`UPDATE scout_candidati SET sito=$2, dominio=$3, segnali = segnali - 'SENZA_SITO', errore_profilo=NULL, updated_at=now() WHERE id=$1`, [c.id, sito, sito ? dominioDi(sito) : null]);
    if (sito) S.accoda([c.id]);
  }
  if (b.categoria && CATEGORIE[b.categoria]) await q('UPDATE scout_candidati SET categoria=$2, updated_at=now() WHERE id=$1', [c.id, b.categoria]);
  if (b.stato === 'SCARTATO') {
    // scartato: restano solo i dati dell'attività per non riproporla; le persone lette dal sito si cancellano
    await q(`UPDATE scout_candidati SET stato='SCARTATO', scartato_motivo=$2, updated_at=now() WHERE id=$1 AND stato <> 'PROMOSSO'`, [c.id, b.motivo || null]);
    await q('DELETE FROM scout_persone WHERE candidato_id=$1 AND contatto_id IS NULL', [c.id]);
  } else if (b.stato === 'NUOVO') await q(`UPDATE scout_candidati SET stato = CASE WHEN profilato_at IS NULL THEN 'NUOVO' ELSE 'PROFILATO' END, scartato_motivo=NULL, updated_at=now() WHERE id=$1 AND stato='SCARTATO'`, [c.id]);
  res.json({ ok: true, coda: S.statoCoda() });
}));
r.post('/candidati/scarta', ah(async (req, res) => {
  const b = parse(z.object({ ids: z.array(z.number().int().positive()).min(1).max(400), motivo: z.string().trim().max(300).optional().nullable() }), req.body);
  const righe = await many(`SELECT id, linea FROM scout_candidati WHERE id = ANY($1::int[]) AND stato IN ('NUOVO','PROFILATO')`, [b.ids]);
  for (const l of new Set(righe.map((x) => x.linea))) richiediLinea(req, l);
  const ids = righe.map((x) => x.id);
  await q(`UPDATE scout_candidati SET stato='SCARTATO', scartato_motivo=$2, updated_at=now() WHERE id = ANY($1::int[])`, [ids, b.motivo || null]);
  await q('DELETE FROM scout_persone WHERE candidato_id = ANY($1::int[]) AND contatto_id IS NULL', [ids]);
  res.json({ scartati: ids.length });
}));
r.post('/candidati/:id/verifica-piva', ah(async (req, res) => {
  const c = await candidato(req.params.id);
  richiediLinea(req, c.linea);
  if (!c.piva) throw bad('Nessuna partita IVA da verificare');
  const v = await verificaPiva(c.piva);
  if (v.ok) await q(`UPDATE scout_candidati SET profilo = jsonb_set(coalesce(profilo,'{}'::jsonb), '{vies}', $2::jsonb), updated_at=now() WHERE id=$1`, [c.id, JSON.stringify(v)]);
  res.json(v);
}));
r.post('/candidati/:id/promuovi', ah(async (req, res) => {
  const c = await candidato(req.params.id);
  richiediLinea(req, c.linea);
  const b = parse(z.object({ fase: z.union([z.literal(0), z.literal(1)]).default(1), owner_user_id: z.number().int().positive().nullable().optional(), persone: z.array(z.number().int().positive()).max(10).default([]) }), req.body || {});
  const out = await S.promuovi(c.id, { fase: b.fase, owner_user_id: b.owner_user_id || null, persone: b.persone, userId: req.user.id, req });
  await audit(req, 'HUB_SCOUT_PROMOSSO', 'account', out.account_id, { candidato: c.id, nome: c.nome, fase: b.fase, org_creata: out.org_creata, referenti: out.referenti });
  res.status(201).json(out);
}));

// ---------------- Account esistente: completa anagrafica e referenti dal sito ----------------
r.get('/account/:id', ah(async (req, res) => { const a = await loadAccount(req.params.id); const o = await one('SELECT website FROM public.organizations WHERE id=$1', [a.organization_id]); res.json({ sito: a.sito_web || o?.website || null, ...(await S.proposteAccount(a)), coda: S.statoCoda(), puo_scrivere: canEditKind(req.user, a.linea) }); }));
r.post('/account/:id/profila', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiediLinea(req, a.linea);
  const b = parse(z.object({ sito: z.string().trim().min(4).max(300) }), req.body);
  const id = await S.candidatoDiAccount(a, b.sito);
  const p = await S.profilaCandidato(id);
  await audit(req, 'HUB_SCOUT_ACCOUNT', 'account', a.id, { sito: b.sito, ok: p?.ok, errore: p?.errore || null });
  res.json({ ok: Boolean(p?.ok), errore: p?.errore || null, ...(await S.proposteAccount(a)) });
}));
r.post('/account/:id/applica', ah(async (req, res) => {
  const a = await loadAccount(req.params.id);
  richiediLinea(req, a.linea);
  const b = parse(z.object({ campi: z.array(z.string()).max(12).default([]), persone: z.array(z.number().int().positive()).max(10).default([]) }), req.body);
  const pr = await S.proposteAccount(a);
  if (!pr.candidato) throw bad('Prima leggi il sito');
  // anagrafica: solo i campi scelti e solo se VUOTI nella Legal entity (un dato già presente non si sovrascrive da qui)
  const COL = Object.fromEntries([...S.CAMPI_ORG.map(([k, col]) => [k, col]), ['sito', 'website']]);
  const fatti = [];
  for (const c of pr.campi.filter((x) => b.campi.includes(x.campo) && x.stato === 'MANCANTE' && COL[x.campo])) {
    const rr = await one(`UPDATE public.organizations SET ${COL[c.campo]}=$2, updated_at=now() WHERE id=$1 AND coalesce(${COL[c.campo]}::text,'')='' RETURNING id`, [a.organization_id, c.proposto]);
    if (rr) fatti.push({ campo: c.campo, valore: c.proposto, url: c.url });
  }
  const ref = await S.portaReferenti(a.id, pr.candidato.id, b.persone);
  if (fatti.length || ref.length) {
    await one(`INSERT INTO activities (account_id, tipo, user_id, oggetto, testo) VALUES ($1,'SISTEMA',$2,'Anagrafica e referenti completati dal sito',$3) RETURNING id`, [a.id, req.user.id,
      [fatti.length ? `Anagrafica: ${fatti.map((f) => `${f.campo} = ${f.valore}`).join('; ')}` : null, ref.length ? `Referenti aggiunti: ${ref.filter((x) => x.nuovo).length}` : null, `Fonte: ${pr.candidato.sito}`].filter(Boolean).join('\n')]);
    await audit(req, 'HUB_SCOUT_APPLICA', 'account', a.id, { campi: fatti, referenti: ref.length, sito: pr.candidato.sito });
  }
  res.json({ ...(await S.proposteAccount(a)), applicati: { campi: fatti.length, referenti: ref.filter((x) => x.nuovo).length } });
}));

export default r;
