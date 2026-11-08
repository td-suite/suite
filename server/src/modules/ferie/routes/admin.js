// Impostazioni del Piano Ferie (profilo ADMIN = HR): parametri generali, spettanze per CCNL e livello, copertura minima, chiusure
// collettive, aree forzate, santi patroni delle sedi, deleghe di approvazione, esecuzione manuale del job. Le letture servono anche
// alle pagine dei dipendenti (chiusure) e dei responsabili (le proprie deleghe).
import { Router } from 'express';
import { z } from 'zod';
import { q, one, many } from '../db.js';
import { ah, parse, audit, notFound, forbidden, bad } from '../../../lib/util.js';
import { SITE_KINDS, SITE_KIND_LABEL } from '../../../lib/tipiSede.js';
import { KEY, DEFAULTS, settings, setSetting, userContext, invalidaPatroni, oggi } from '../lib/core.js';
import { invalidaPerimetro, nomeGruppo } from '../lib/perimetro.js';
import { festiviNazionali } from '../lib/calendario.js';
import { eseguiJob } from '../lib/job.js';
import { annoQ } from './richieste.js';

const r = Router();
const admin = async (req) => { const ctx = await userContext(req); if (!ctx.isAdmin) throw forbidden('Operazione riservata a HR (amministratore del modulo)'); return ctx; };
const data = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data non valida (AAAA-MM-GG)');
const gruppoRe = /^(DIR|LAB|SEDE:\d+)$/;

// Catalogo per le tendine: ruoli, sedi TD, tipi di sede, aree del perimetro, persone del perimetro (HR)
r.get('/catalogo', ah(async (req, res) => {
  const ctx = await userContext(req);
  const ruoli = await many('SELECT id, name FROM public.job_roles WHERE active ORDER BY lower(name)');
  const sedi = await many(`SELECT id, code, name, short_name, kind, city FROM public.sites WHERE active AND kind <> 'SERVICE' ORDER BY lower(name)`);
  res.json({
    ruoli, sedi, tipi_sede: SITE_KINDS.filter((k) => k !== 'SERVICE').map((k) => ({ key: k, label: SITE_KIND_LABEL[k] })),
    gruppi: ctx.perim.gruppi,
    persone: ctx.tutto ? [...ctx.perim.persone.values()].map((p) => ({ id: p.id, nome: p.nome, gruppo: p.gruppo, gruppo_nome: nomeGruppo(p.gruppo, ctx.perim.siti) })) : [],
  });
}));

// ---------------------------------------------------------------- generali
const impSchema = z.object({
  includi_dirigenti: z.boolean().optional(), soglia_mese_giorni: z.coerce.number().int().min(1).max(31).optional(),
  scadenza_ap: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Scadenza nel formato MM-GG').optional(),
  mesi_rischio: z.array(z.coerce.number().int().min(1).max(12)).max(12).optional(), soglia_rischio_giorni: z.coerce.number().min(0).max(60).optional(),
  promemoria_giorni: z.coerce.number().int().min(1).max(60).optional(), email_attiva: z.boolean().optional(), festa_4_ottobre: z.boolean().optional(),
  festivi_aggiunti: z.array(z.object({ data, nome: z.string().trim().min(1).max(80) })).max(100).optional(), festivi_esclusi: z.array(data).max(100).optional(),
  rol_attivi: z.boolean().optional(), avviso_dipendenti: z.string().trim().max(2000).optional(),
  // data entro cui i dipendenti inviano il piano di un anno: { 'AAAA': 'AAAA-MM-GG' } (la data può cadere nell'anno prima)
  scadenze_piano: z.record(z.string().regex(/^\d{4}$/, 'Anno non valido'), data).optional(),
  promemoria_scadenza_giorni: z.coerce.number().int().min(0).max(60).optional(),
});
r.get('/impostazioni', ah(async (req, res) => {
  const ctx = await userContext(req);
  const s = await settings();
  const anno = annoQ(req.query.anno);
  res.json({ ...s, predefiniti: DEFAULTS, festivi_nazionali: festiviNazionali(anno, { quattroOttobre: s.festa_4_ottobre !== false }), anno, modificabile: ctx.isAdmin });
}));
r.put('/impostazioni', ah(async (req, res) => {
  await admin(req);
  const b = parse(impSchema, req.body || {});
  for (const [k, v] of Object.entries(b)) if (v !== undefined) await setSetting(k, v);
  invalidaPerimetro();
  await audit(req, 'FERIE_IMPOSTAZIONI', { module: KEY, entity: 'impostazioni', label: Object.keys(b).join(', ') });
  res.json(await settings());
}));

// ---------------------------------------------------------------- spettanze per CCNL e livello
r.get('/spettanze', ah(async (_req, res) => {
  const usati = await one(`SELECT to_regclass('contracts.employments') IS NOT NULL AS ok`);
  const combinazioni = usati?.ok ? await many(`SELECT ccnl, coalesce(level, '*') AS level, count(*)::int AS persone FROM contracts.employments GROUP BY 1, 2 ORDER BY 1, 2`) : [];
  res.json({ righe: await many('SELECT * FROM spettanze ORDER BY (ccnl = \'*\') DESC, ccnl, (level = \'*\') DESC, level'), combinazioni });
}));
const spSchema = z.object({ ccnl: z.string().trim().min(1).max(60), level: z.string().trim().min(1).max(20), giorni_annui: z.coerce.number().min(0).max(60), rol_ore_annue: z.coerce.number().min(0).max(400).optional().nullable(), note: z.string().trim().max(300).optional().nullable() });
r.put('/spettanze', ah(async (req, res) => {
  await admin(req);
  const b = parse(spSchema, req.body || {});
  await q(`INSERT INTO spettanze (ccnl, level, giorni_annui, rol_ore_annue, note, updated_at) VALUES ($1,$2,$3,$4,$5,now())
      ON CONFLICT (ccnl, level) DO UPDATE SET giorni_annui=EXCLUDED.giorni_annui, rol_ore_annue=EXCLUDED.rol_ore_annue, note=EXCLUDED.note, updated_at=now()`, [b.ccnl, b.level, b.giorni_annui, b.rol_ore_annue ?? null, b.note || null]);
  await audit(req, 'FERIE_SPETTANZA', { module: KEY, entity: 'spettanza', entityId: `${b.ccnl}:${b.level}`, label: `${b.ccnl} ${b.level}: ${b.giorni_annui} giorni`, data: b });
  res.json(await many('SELECT * FROM spettanze ORDER BY ccnl, level'));
}));
r.delete('/spettanze/:ccnl/:level', ah(async (req, res) => {
  await admin(req);
  if (req.params.ccnl === '*' && req.params.level === '*') throw bad('La riga predefinita (qualunque CCNL e livello) non si elimina: modificala');
  await q('DELETE FROM spettanze WHERE ccnl=$1 AND level=$2', [req.params.ccnl, req.params.level]);
  await audit(req, 'FERIE_SPETTANZA_ELIMINATA', { module: KEY, entity: 'spettanza', entityId: `${req.params.ccnl}:${req.params.level}` });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- copertura minima
const copSchema = z.object({ ambito: z.string().regex(/^(DIR|LAB|SEDE:\d+|KIND:[A-Z_]+)$/, 'Ambito non valido'), role_id: z.coerce.number().int().positive().optional().nullable(), minimo: z.coerce.number().int().min(1).max(99), note: z.string().trim().max(300).optional().default('') });
const COP_SQL = 'SELECT c.*, jr.name AS role_name FROM coperture c LEFT JOIN public.job_roles jr ON jr.id=c.role_id';
r.get('/coperture', ah(async (req, res) => {
  const ctx = await userContext(req);
  const rows = await many(`${COP_SQL} ORDER BY c.ambito, jr.name NULLS FIRST`);
  // fuori da ADMIN e VIEWER: solo le regole delle aree visibili (la propria e quelle gestite)
  const kinds = new Set(ctx.gruppi.map((g) => ctx.perim.siti?.get?.(Number(String(g).slice(5)))?.kind).filter(Boolean));
  const visibile = (c) => ctx.tutto || ctx.vedeGruppo(c.ambito) || (c.ambito.startsWith('KIND:') && kinds.has(c.ambito.slice(5)));
  res.json(rows.filter(visibile).map((c) => ({ ...c, ambito_nome: nomeGruppo(c.ambito, ctx.perim.siti) })));
}));
async function verificaCop(b) {
  if (b.ambito.startsWith('KIND:') && !SITE_KINDS.includes(b.ambito.slice(5))) throw bad('Tipo di sede sconosciuto');
  if (b.ambito.startsWith('SEDE:') && !(await one('SELECT 1 FROM public.sites WHERE id=$1', [Number(b.ambito.slice(5))]))) throw bad('Sede inesistente');
  if (b.role_id && !(await one('SELECT 1 FROM public.job_roles WHERE id=$1', [b.role_id]))) throw bad('Ruolo inesistente');
}
r.post('/coperture', ah(async (req, res) => {
  await admin(req);
  const b = parse(copSchema, req.body || {});
  await verificaCop(b);
  if (await one('SELECT 1 FROM coperture WHERE ambito=$1 AND coalesce(role_id,0)=coalesce($2::int,0)', [b.ambito, b.role_id || null])) throw bad('Esiste già una regola per questo ambito e ruolo: modificala');
  const c = await one('INSERT INTO coperture (ambito, role_id, minimo, note) VALUES ($1,$2,$3,$4) RETURNING id', [b.ambito, b.role_id || null, b.minimo, b.note]);
  await audit(req, 'FERIE_COPERTURA', { module: KEY, entity: 'copertura', entityId: c.id, label: `${b.ambito} minimo ${b.minimo}`, data: b });
  res.status(201).json(await one(`${COP_SQL} WHERE c.id=$1`, [c.id]));
}));
r.put('/coperture/:id', ah(async (req, res) => {
  await admin(req);
  const cur = await one('SELECT * FROM coperture WHERE id=$1', [Number(req.params.id)]);
  if (!cur) throw notFound('Regola non trovata');
  const b = parse(copSchema, { ...cur, ...req.body });
  await verificaCop(b);
  await q('UPDATE coperture SET ambito=$2, role_id=$3, minimo=$4, note=$5, updated_at=now() WHERE id=$1', [cur.id, b.ambito, b.role_id || null, b.minimo, b.note]);
  await audit(req, 'FERIE_COPERTURA', { module: KEY, entity: 'copertura', entityId: cur.id, label: `${b.ambito} minimo ${b.minimo}`, data: b });
  res.json(await one(`${COP_SQL} WHERE c.id=$1`, [cur.id]));
}));
r.delete('/coperture/:id', ah(async (req, res) => {
  await admin(req);
  await q('DELETE FROM coperture WHERE id=$1', [Number(req.params.id)]);
  await audit(req, 'FERIE_COPERTURA_ELIMINATA', { module: KEY, entity: 'copertura', entityId: Number(req.params.id) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- chiusure collettive
const chSchema = z.object({ gruppo: z.string().regex(/^(TUTTE|DIR|LAB|SEDE:\d+)$/, 'Area non valida'), data_inizio: data, data_fine: data, descrizione: z.string().trim().max(200).optional().default('') });
r.get('/chiusure', ah(async (req, res) => {
  const ctx = await userContext(req);
  const anno = annoQ(req.query.anno);
  const rows = await many(`SELECT * FROM chiusure WHERE data_fine >= $1 AND data_inizio <= $2 ORDER BY data_inizio`, [`${anno}-01-01`, `${anno}-12-31`]);
  res.json(rows.filter((c) => c.gruppo === 'TUTTE' || ctx.vedeGruppo(c.gruppo)).map((c) => ({ ...c, gruppo_nome: nomeGruppo(c.gruppo, ctx.perim.siti) })));
}));
r.post('/chiusure', ah(async (req, res) => {
  const ctx = await admin(req);
  const b = parse(chSchema, req.body || {});
  if (b.data_fine < b.data_inizio) throw bad('La data di fine precede quella di inizio');
  const c = await one('INSERT INTO chiusure (gruppo, data_inizio, data_fine, descrizione, created_by_user_id) VALUES ($1,$2,$3,$4,$5) RETURNING *', [b.gruppo, b.data_inizio, b.data_fine, b.descrizione, ctx.uid]);
  await audit(req, 'FERIE_CHIUSURA', { module: KEY, entity: 'chiusura', entityId: c.id, label: `${nomeGruppo(b.gruppo, ctx.perim.siti)} ${b.data_inizio} → ${b.data_fine}`, data: b });
  res.status(201).json(c);
}));
r.delete('/chiusure/:id', ah(async (req, res) => {
  await admin(req);
  const c = await one('DELETE FROM chiusure WHERE id=$1 RETURNING *', [Number(req.params.id)]);
  if (!c) throw notFound('Chiusura non trovata');
  await audit(req, 'FERIE_CHIUSURA_ELIMINATA', { module: KEY, entity: 'chiusura', entityId: c.id, label: `${c.gruppo} ${c.data_inizio} → ${c.data_fine}` });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- aree forzate
r.get('/aree-forzate', ah(async (req, res) => {
  const ctx = await userContext(req);
  if (!ctx.tutto) throw forbidden();
  const rows = await many(`SELECT af.*, p.last_name || ' ' || p.first_name AS persona FROM aree_forzate af JOIN public.people p ON p.id=af.person_id ORDER BY lower(p.last_name)`);
  res.json(rows.map((x) => ({ ...x, gruppo_nome: nomeGruppo(x.gruppo, ctx.perim.siti) })));
}));
r.put('/aree-forzate/:personId', ah(async (req, res) => {
  const ctx = await admin(req);
  const b = parse(z.object({ gruppo: z.string().regex(gruppoRe, 'Area non valida'), note: z.string().trim().max(300).optional().default('') }), req.body || {});
  const pid = Number(req.params.personId);
  if (!(await one('SELECT 1 FROM public.people WHERE id=$1', [pid]))) throw notFound('Persona non trovata');
  if (b.gruppo.startsWith('SEDE:') && !(await one(`SELECT 1 FROM public.sites WHERE id=$1 AND kind <> 'SERVICE'`, [Number(b.gruppo.slice(5))]))) throw bad('Sede non valida');
  await q(`INSERT INTO aree_forzate (person_id, gruppo, note, updated_by_user_id, updated_at) VALUES ($1,$2,$3,$4,now()) ON CONFLICT (person_id) DO UPDATE SET gruppo=EXCLUDED.gruppo, note=EXCLUDED.note, updated_by_user_id=EXCLUDED.updated_by_user_id, updated_at=now()`, [pid, b.gruppo, b.note, ctx.uid]);
  invalidaPerimetro();
  await audit(req, 'FERIE_AREA_FORZATA', { module: KEY, entity: 'persona', entityId: pid, label: nomeGruppo(b.gruppo, ctx.perim.siti), data: b });
  res.json({ ok: true });
}));
r.delete('/aree-forzate/:personId', ah(async (req, res) => {
  await admin(req);
  await q('DELETE FROM aree_forzate WHERE person_id=$1', [Number(req.params.personId)]);
  invalidaPerimetro();
  await audit(req, 'FERIE_AREA_FORZATA_TOLTA', { module: KEY, entity: 'persona', entityId: Number(req.params.personId) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- santi patroni
r.get('/patroni', ah(async (_req, res) => res.json(await many(`SELECT pt.*, s.name AS sede, s.city FROM patroni pt JOIN public.sites s ON s.id=pt.site_id ORDER BY lower(s.name)`))));
r.put('/patroni/:siteId', ah(async (req, res) => {
  await admin(req);
  const b = parse(z.object({ giorno: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Giorno nel formato MM-GG'), santo: z.string().trim().max(80).optional().default('') }), req.body || {});
  const sid = Number(req.params.siteId);
  if (!(await one('SELECT 1 FROM public.sites WHERE id=$1', [sid]))) throw notFound('Sede non trovata');
  await q('INSERT INTO patroni (site_id, giorno, santo, updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (site_id) DO UPDATE SET giorno=EXCLUDED.giorno, santo=EXCLUDED.santo, updated_at=now()', [sid, b.giorno, b.santo]);
  invalidaPatroni();
  await audit(req, 'FERIE_PATRONO', { module: KEY, entity: 'sede', entityId: sid, label: `${b.giorno} ${b.santo}` });
  res.json({ ok: true });
}));
r.delete('/patroni/:siteId', ah(async (req, res) => {
  await admin(req);
  await q('DELETE FROM patroni WHERE site_id=$1', [Number(req.params.siteId)]);
  invalidaPatroni();
  await audit(req, 'FERIE_PATRONO_TOLTO', { module: KEY, entity: 'sede', entityId: Number(req.params.siteId) });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- deleghe di approvazione (HR tutte; un responsabile le proprie)
const DEL_SQL = `SELECT d.*, a.last_name || ' ' || a.first_name AS delegante, b.last_name || ' ' || b.first_name AS delegato FROM deleghe d
  JOIN public.people a ON a.id=d.delegante_person_id JOIN public.people b ON b.id=d.delegato_person_id`;
r.get('/deleghe', ah(async (req, res) => {
  const ctx = await userContext(req);
  const rows = ctx.tutto ? await many(`${DEL_SQL} WHERE d.al >= $1 ORDER BY d.dal`, [oggi()])
    : await many(`${DEL_SQL} WHERE d.al >= $1 AND (d.delegante_person_id=$2 OR d.delegato_person_id=$2) ORDER BY d.dal`, [oggi(), ctx.personId || 0]);
  res.json(rows);
}));
r.post('/deleghe', ah(async (req, res) => {
  const ctx = await userContext(req);
  const b = parse(z.object({ delegante_person_id: z.coerce.number().int().positive().optional(), delegato_person_id: z.coerce.number().int().positive(), dal: data, al: data, note: z.string().trim().max(300).optional().default('') }), req.body || {});
  const delegante = b.delegante_person_id || ctx.personId;
  if (!delegante) throw bad('Account non collegato a una persona');
  if (delegante !== ctx.personId && !ctx.isAdmin) throw forbidden('Puoi delegare solo le tue approvazioni');
  if (!ctx.isAdmin && !ctx.isApprovatore) throw forbidden('Non hai approvazioni da delegare');
  if (b.al < b.dal) throw bad('La data di fine precede quella di inizio');
  if (delegante === b.delegato_person_id) throw bad('Delegante e delegato coincidono');
  if (!(await one(`SELECT 1 FROM public.people WHERE id=$1 AND status='ATTIVO'`, [b.delegato_person_id]))) throw bad('Delegato non valido');
  const d = await one('INSERT INTO deleghe (delegante_person_id, delegato_person_id, dal, al, note, created_by_user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [delegante, b.delegato_person_id, b.dal, b.al, b.note, ctx.uid]);
  await audit(req, 'FERIE_DELEGA', { module: KEY, entity: 'delega', entityId: d.id, label: `${b.dal} → ${b.al}`, data: { delegante, delegato: b.delegato_person_id } });
  res.status(201).json(await one(`${DEL_SQL} WHERE d.id=$1`, [d.id]));
}));
r.delete('/deleghe/:id', ah(async (req, res) => {
  const ctx = await userContext(req);
  const d = await one('SELECT * FROM deleghe WHERE id=$1', [Number(req.params.id)]);
  if (!d) throw notFound('Delega non trovata');
  if (!ctx.isAdmin && d.delegante_person_id !== ctx.personId) throw forbidden();
  await q('DELETE FROM deleghe WHERE id=$1', [d.id]);
  await audit(req, 'FERIE_DELEGA_ELIMINATA', { module: KEY, entity: 'delega', entityId: d.id });
  res.json({ ok: true });
}));

// Persone attive per la scelta del delegato (anche fuori dal perimetro: un collega responsabile)
r.get('/delegabili', ah(async (req, res) => {
  const ctx = await userContext(req);
  if (!ctx.isAdmin && !ctx.isApprovatore) throw forbidden('Le deleghe le gestiscono il responsabile dell\'area e l\'amministratore');
  res.json(await many(`SELECT id, last_name || ' ' || first_name AS nome FROM public.people WHERE status='ATTIVO' AND kind <> 'ESTERNO' ORDER BY lower(last_name), lower(first_name)`));
}));

// Esecuzione immediata del job giornaliero (passaggio a GODUTA, promemoria di piani non inviati, piani e variazioni da approvare)
r.post('/admin/job', ah(async (req, res) => {
  await admin(req);
  const out = await eseguiJob();
  await audit(req, 'FERIE_JOB', { module: KEY, entity: 'job', label: 'Esecuzione manuale', data: out });
  res.json(out);
}));

export default r;
