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
import { loadAccount } from './hub.js';

const r = Router();
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
r.get('/ricerche', ah(async (req, res) => res.json(await many(`SELECT r.*, u.full_name AS creata_da FROM scout_ricerche r LEFT JOIN users u ON u.id=r.created_by WHERE ($1::text IS NULL OR r.linea=$1) ORDER BY r.id DESC LIMIT 30`, [req.query.linea || null]))));
r.post('/ricerche', ah(async (req, res) => {
  const b = parse(z.object({ linea: LINEA, province: z.array(z.string()).min(1).max(10), categorie: z.array(z.string()).min(1).max(12) }), req.body);
  richiediLinea(req, b.linea);
  if (b.province.some((p) => !PROVINCE[p])) throw bad('Provincia non prevista');
  if (b.categorie.some((c) => !CATEGORIE[c]?.linee.includes(b.linea))) throw bad('Tipologia non prevista per questa linea');
  if (await one(`SELECT 1 FROM scout_ricerche WHERE stato='IN_CORSO' AND created_at > now() - interval '15 minutes'`)) throw bad('C\'è già una ricerca in corso: attendi che finisca');
  const { ricerca } = await S.avviaRicerca({ ...b, userId: req.user.id });
  await audit(req, 'HUB_SCOUT_RICERCA', 'scouting', ricerca.id, { linea: b.linea, province: b.province, categorie: b.categorie });
  res.status(202).json(ricerca);
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
