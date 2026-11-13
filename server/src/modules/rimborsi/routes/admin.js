// Rimborso Spese · Impostazioni (P&C e titolare): parametri generali (giorno limite, tariffa predefinita VUOTA, P&C in più, promemoria,
// email), categorie con massimali facoltativi e flag "giustificativo obbligatorio", eccezioni al giustificativo, esecuzione del job.
// Modulistica cartacea: i due moduli SGI in uso (TD-SGI-MOD025 e TD-SGI-MOD029, revisione 00 del 12/04/2026) si scaricano con gli
// stessi permessi del modulo; se il SGI Management della Suite li ha in archivio, il link alla sua scheda.
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { q, one, many } from '../db.js';
import { ah, bad, forbidden, notFound, parse, audit } from '../../../lib/util.js';
import { getModuleState, moduleDb } from '../../../lib/modules.js';
import { ASSETS, MODULI_CARTACEI, RIF_PROCEDURA } from '../config.js';
import { KEY, DEFAULTS, settings, setSetting, userContext, invalidaPerimetro } from '../lib/core.js';
import { caricaSemeEccezioni, eliminaEccezione } from '../lib/eccezioni.js';
import { eseguiJob } from '../lib/job.js';

const r = Router();
const gestore = async (req) => { const ctx = await userContext(req); if (!ctx.isPC && !ctx.isTitolare) throw forbidden('Impostazioni riservate a P&C e al titolare'); return ctx; };
const soldi = () => z.preprocess((v) => (v === '' || v == null ? null : typeof v === 'string' ? Number(v.replace(',', '.')) : v), z.number().positive().max(100000).nullable());

// ---------------------------------------------------------------- modulistica cartacea
/** Collegamenti al SGI Management della Suite (se i due moduli sono nello specchio del portale SGI) */
export async function linkSgi() {
  try {
    if ((await getModuleState('sgi')).mode !== 'LIVE') return {};
    const c = await moduleDb('sgi').one(`SELECT json FROM contenuti WHERE chiave = 'docs'`);
    const codici = new Set((Array.isArray(c?.json) ? c.json : []).map((d) => String(d?.code || '').split('_')[0]));
    return Object.fromEntries(Object.entries(MODULI_CARTACEI).filter(([, m]) => codici.has(m.codice)).map(([k, m]) => [k, `/sgi/doc/${m.codice}`]));
  } catch { return {}; }
}
export async function moduliCartacei() {
  const sgi = await linkSgi();
  return Object.entries(MODULI_CARTACEI).map(([k, m]) => ({ key: k, ...m, url: `/api/rimborsi/moduli/${k}.pdf`, sgi: sgi[k] || null }));
}
r.get('/moduli', ah(async (_req, res) => res.json({ moduli: await moduliCartacei(), rif_procedura: RIF_PROCEDURA })));
r.get('/moduli/:k.pdf', ah(async (req, res) => {
  const m = MODULI_CARTACEI[req.params.k];
  if (!m) throw notFound('Modulo inesistente');
  const file = path.join(ASSETS, m.file);
  if (!fs.existsSync(file)) throw notFound('Modulo non disponibile');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="${m.file}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(file).pipe(res);
}));

// ---------------------------------------------------------------- impostazioni generali
const impSchema = z.object({
  giorno_limite: z.coerce.number().int().min(1).max(28).optional(),
  tariffa_km_default: z.preprocess((v) => (v === '' || v == null ? null : typeof v === 'string' ? Number(v.replace(',', '.')) : v), z.number().positive().max(9.9999).nullable()).optional(),
  tariffa_km_default_fonte: z.string().trim().max(200).optional(),
  pc_person_ids: z.array(z.coerce.number().int()).max(20).optional(),
  promemoria_bozza_giorni_prima: z.coerce.number().int().min(0).max(20).optional(),
  promemoria_responsabile_giorni: z.coerce.number().int().min(1).max(60).optional(),
  email_attiva: z.boolean().optional(), risali_se_in_ferie: z.boolean().optional(),
  avviso_dipendenti: z.string().trim().max(2000).optional(),
  // invio del PDF di approvazione a destinatari ESTERNI all'azienda (consulente del lavoro)
  invio_approvazione_attivo: z.boolean().optional(), allega_giustificativi: z.boolean().optional(),
  mittente_approvazione: z.string().trim().toLowerCase().email('mittente non valido').max(200).optional(),
  destinatari_approvazione: z.array(z.object({ nome: z.string().trim().max(120).default(''), email: z.string().trim().toLowerCase().email('email del destinatario non valida').max(200) })).max(10).optional(),
});
r.get('/impostazioni', ah(async (req, res) => {
  const ctx = await gestore(req);
  const s = await settings();
  const persone = [...ctx.perim.persone.values()].map((p) => ({ id: p.id, nome: p.nome, approvatore: p.approvatore_nome, al_pc: p.al_pc, origine: p.origine }));
  const pcGrant = (await many(`SELECT DISTINCT u.person_id FROM public.grants g JOIN public.users u ON u.id = g.user_id WHERE g.module_key='contracts' AND g.profile='ADMIN' AND NOT g.proposed AND u.status='ACTIVE' AND u.person_id IS NOT NULL`)).map((x) => x.person_id);
  res.json({ ...s, predefiniti: DEFAULTS, persone, pc: [...ctx.pc].map((id) => ({ id, nome: ctx.perim.persone.get(id)?.nome, da_grant: pcGrant.includes(id) })), modificabile: true });
}));
r.put('/impostazioni', ah(async (req, res) => {
  const ctx = await gestore(req);
  const b = parse(impSchema, req.body || {});
  if (b.tariffa_km_default != null && !String(b.tariffa_km_default_fonte ?? (await settings()).tariffa_km_default_fonte ?? '').trim()) throw bad('Indica la fonte della tariffa predefinita (es. "tabelle ACI 2026")');
  if (b.pc_person_ids) { const fuori = b.pc_person_ids.filter((id) => !ctx.perim.persone.has(id)); if (fuori.length) throw bad('P&C deve essere un dipendente attivo'); }
  for (const [k, v] of Object.entries(b)) if (v !== undefined) await setSetting(k, v);
  invalidaPerimetro();
  await audit(req, 'RIMBORSI_IMPOSTAZIONI', { module: KEY, entity: 'impostazioni', label: Object.keys(b).join(', '), data: b });   // anche i destinatari esterni del PDF: chi li ha cambiati e quando
  res.json(await settings());
}));

// ---------------------------------------------------------------- categorie
const catSchema = z.object({
  nome: z.string().trim().min(2).max(80), tipo: z.enum(['SPESA', 'PEDAGGIO', 'PARCHEGGIO', 'CARBURANTE']).default('SPESA'),
  massimale_spesa: soldi().optional(), massimale_giorno: soldi().optional(), giustificativo_obbligatorio: z.boolean().default(true), attiva: z.boolean().default(true),
  ordine: z.coerce.number().int().min(0).max(9999).default(100), note: z.string().trim().max(500).nullable().optional(),
});
r.get('/categorie', ah(async (_req, res) => res.json(await many('SELECT * FROM categorie ORDER BY ordine, id'))));
r.post('/categorie', ah(async (req, res) => {
  await gestore(req);
  const b = parse(catSchema, req.body || {});
  const codice = b.nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'CATEGORIA';
  const row = await one(`INSERT INTO categorie (codice, nome, tipo, massimale_spesa, massimale_giorno, giustificativo_obbligatorio, attiva, ordine, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [`${codice}_${Date.now().toString(36).slice(-4).toUpperCase()}`, b.nome, b.tipo, b.massimale_spesa ?? null, b.massimale_giorno ?? null, b.giustificativo_obbligatorio, b.attiva, b.ordine, b.note || null]);
  await audit(req, 'RIMBORSI_CATEGORIA', { module: KEY, entity: 'categoria', entityId: row.id, label: row.nome, data: b });
  res.status(201).json(row);
}));
r.put('/categorie/:cid', ah(async (req, res) => {
  await gestore(req);
  const b = parse(catSchema, req.body || {});
  const row = await one(`UPDATE categorie SET nome=$2, tipo=$3, massimale_spesa=$4, massimale_giorno=$5, giustificativo_obbligatorio=$6, attiva=$7, ordine=$8, note=$9, updated_at=now() WHERE id=$1 RETURNING *`,
    [Number(req.params.cid), b.nome, b.tipo, b.massimale_spesa ?? null, b.massimale_giorno ?? null, b.giustificativo_obbligatorio, b.attiva, b.ordine, b.note || null]);
  if (!row) throw notFound('Categoria inesistente');
  await audit(req, 'RIMBORSI_CATEGORIA', { module: KEY, entity: 'categoria', entityId: row.id, label: row.nome, data: b });
  res.json(row);
}));

// ---------------------------------------------------------------- eccezioni al giustificativo obbligatorio
const eccezioniVista = () => many(`SELECT e.*, p.last_name || ' ' || p.first_name AS persona, p.kind AS persona_kind, p.status AS persona_status, u.full_name AS creata_da
    FROM eccezioni e LEFT JOIN public.people p ON p.id = e.person_id LEFT JOIN public.users u ON u.id = e.created_by ORDER BY e.person_id IS NULL DESC, lower(coalesce(p.last_name, e.cognome_seme))`);
r.get('/eccezioni', ah(async (req, res) => { await gestore(req); res.json({ righe: await eccezioniVista(), seme: (await settings()).seme_eccezioni || null }); }));
r.post('/eccezioni', ah(async (req, res) => {
  const ctx = await gestore(req);
  const b = parse(z.object({ person_id: z.coerce.number().int(), nota: z.string().trim().max(500).optional(), sostituisce_id: z.coerce.number().int().optional() }), req.body || {});
  if (!ctx.perim.persone.has(b.person_id)) throw bad('Scegli un dipendente attivo');
  if (await one('SELECT 1 FROM eccezioni WHERE person_id=$1', [b.person_id])) throw bad('Il dipendente ha già l\'eccezione');
  // abbinamento a mano di una voce del seme non abbinata (cognome con omonimi)
  if (b.sostituisce_id) {
    const s = await one(`UPDATE eccezioni SET person_id=$2, nota=$3, created_by=$4, updated_at=now() WHERE id=$1 AND person_id IS NULL RETURNING id`, [b.sostituisce_id, b.person_id, b.nota || 'abbinata a mano da P&C', ctx.uid]);
    if (!s) throw notFound('Voce del seme inesistente o già abbinata');
  } else await q(`INSERT INTO eccezioni (person_id, origine, nota, created_by) VALUES ($1,'MANUALE',$2,$3)`, [b.person_id, b.nota || null, ctx.uid]);
  await audit(req, 'RIMBORSI_ECCEZIONE', { module: KEY, entity: 'persona', entityId: b.person_id, label: ctx.perim.persone.get(b.person_id)?.nome, data: b });
  res.status(201).json(await eccezioniVista());
}));
r.delete('/eccezioni/:eid', ah(async (req, res) => {
  await gestore(req);
  const e = await eliminaEccezione(Number(req.params.eid));
  if (!e) throw notFound('Eccezione inesistente');
  await audit(req, 'RIMBORSI_ECCEZIONE_ELIMINATA', { module: KEY, entity: 'persona', entityId: e.person_id, label: e.cognome_seme || null });
  res.json(await eccezioniVista());
}));
r.post('/eccezioni/seme', ah(async (req, res) => { await gestore(req); res.json({ esito: await caricaSemeEccezioni(), righe: await eccezioniVista() }); }));

// ---------------------------------------------------------------- job manuale
r.post('/job', ah(async (req, res) => { await gestore(req); res.json(await eseguiJob({ forza: true })); }));

export default r;
