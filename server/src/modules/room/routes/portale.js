// Portale del professionista (ruolo PROF): i propri dati, disponibilità, turni confermati, presenze, rendiconti, bacheca.
import { Router } from 'express';
import { z } from 'zod';
import { one, many, q } from '../db.js';
import { ah, bad, notFound, forbidden, audit, parse } from '../lib/util.js';
import { profOfUser, sediMap, validMese } from '../lib/personale.js';
import { dispSchema, saveDisp } from './personale.js';

const r = Router();
r.use(ah(async (req, _res, next) => {
  const p = await profOfUser(req.user);
  if (!p) throw forbidden('Nessun profilo di professionista collegato a questo utente: contatta il Responsabile del personale sanitario');
  req.prof = p; next();
}));

// Campi che il professionista può aggiornare da solo (contatti e coordinate bancarie); il resto lo gestisce la struttura
const SELF = ['telefono', 'cellulare', 'indirizzo', 'cap', 'citta', 'provincia', 'pec', 'iban', 'intestatarioConto'];
r.get('/me', ah(async (req, res) => {
  const p = req.prof; const sm = await sediMap();
  const docs = await many('SELECT id, tipo, nome, size, scadenza, created_at FROM professionista_docs WHERE prof_id=$1 ORDER BY created_at DESC', [p.id]);
  res.json({ id: p.id, nome: p.nome, tipo: p.tipo, profilo: p.profilo, email: p.email, anagrafica: p.dati?.anagrafica || {}, professionale: p.dati?.professionale || {}, contratto: p.dati?.contratto || {}, assicurazione: p.dati?.assicurazione || {},
    compenso: { tipo: p.dati?.compenso?.tipo || 'ORARIO', tariffaOraria: p.dati?.compenso?.tariffaOraria || null, fissoMensile: p.dati?.compenso?.fissoMensile || null, eccezioniSede: (p.dati?.compenso?.eccezioniSede || []).map((e) => ({ ...e, sede: sm[e.sedeId] || e.sedeId })) },
    sediAbilitate: (p.dati?.sediAbilitate || []).map((id) => ({ id, label: sm[id] || id })), docs, selfFields: SELF });
}));
r.put('/me', ah(async (req, res) => {
  const d = parse(z.object(Object.fromEntries(SELF.map((k) => [k, z.string().max(200).optional().nullable()]))), req.body);
  const dati = { ...(req.prof.dati || {}) }; dati.anagrafica = { ...(dati.anagrafica || {}) };
  for (const k of SELF) if (d[k] !== undefined) dati.anagrafica[k] = d[k] || '';
  await q('UPDATE professionisti SET dati=$2, updated_at=now(), updated_by=$3 WHERE id=$1', [req.prof.id, JSON.stringify(dati), req.user.id]);
  await audit(req, 'PROF_SELF_UPDATE', 'professionista', req.prof.id); res.json({ ok: true });
}));
r.get('/sedi', ah(async (_req, res) => { const sm = await sediMap(); res.json(Object.entries(sm).map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, 'it'))); }));

// Disponibilità
r.get('/disponibilita', ah(async (req, res) => res.json(await many('SELECT * FROM disponibilita WHERE prof_id=$1 ORDER BY kind, giorno, data, ora_da', [req.prof.id]))));
r.post('/disponibilita', ah(async (req, res) => { const d = parse(dispSchema, req.body); const id = await saveDisp(req.prof.id, d); await audit(req, 'DISP_ADD', 'disponibilita', id); res.status(201).json({ id }); }));
r.put('/disponibilita/:id', ah(async (req, res) => {
  const row = await one('SELECT id FROM disponibilita WHERE id=$1 AND prof_id=$2', [req.params.id, req.prof.id]); if (!row) throw notFound();
  await saveDisp(req.prof.id, parse(dispSchema, req.body), row.id); res.json({ ok: true });
}));
r.delete('/disponibilita/:id', ah(async (req, res) => { await q('DELETE FROM disponibilita WHERE id=$1 AND prof_id=$2', [req.params.id, req.prof.id]); res.json({ ok: true }); }));

// Turni (solo mesi confermati) e presenze
r.get('/turni', ah(async (req, res) => {
  const m = String(req.query.mese || ''); if (!validMese(m)) throw bad('mese');
  const st = await one('SELECT * FROM turni_mesi WHERE mese=$1', [m]);
  if (!st || st.stato !== 'CONFERMATO') return res.json({ confermato: false, turni: [] });
  const sm = await sediMap();
  const turni = await many('SELECT id, data, ora_da, ora_a, sede_id, attivita, nota FROM turni WHERE prof_id=$1 AND mese=$2 ORDER BY data, ora_da', [req.prof.id, m]);
  res.json({ confermato: true, confermatoAt: st.confermato_at, turni: turni.map((t) => ({ ...t, sede: sm[t.sede_id] || t.sede_id })) });
}));
r.get('/presenze', ah(async (req, res) => {
  const m = String(req.query.mese || ''); if (!validMese(m)) throw bad('mese');
  const sm = await sediMap();
  const rows = await many("SELECT id, data, ora_da, ora_a, sede_id, stato, attivita, nota, confermato_at, rendiconto_id FROM presenze WHERE prof_id=$1 AND to_char(data,'YYYY-MM')=$2 ORDER BY data, ora_da", [req.prof.id, m]);
  res.json(rows.map((t) => ({ ...t, sede: sm[t.sede_id] || t.sede_id })));
}));
// Rendiconti: visibili dal momento dell'approvazione
r.get('/rendiconti', ah(async (req, res) => res.json(await many("SELECT id, mese, stato, ore, importo, approvato_at, inviato_at, (dettaglio->'oneri'->>'totaleFattura')::numeric AS totale_fattura FROM rendiconti WHERE prof_id=$1 AND stato IN ('APPROVATO','INVIATO') ORDER BY mese DESC", [req.prof.id]))));
r.get('/rendiconti/:id', ah(async (req, res) => {
  const x = await one("SELECT r.*, p.nome, p.profilo, ua.full_name AS approvato_da_nome FROM rendiconti r JOIN professionisti p ON p.id=r.prof_id LEFT JOIN users ua ON ua.id=r.approvato_da WHERE r.id=$1 AND r.prof_id=$2 AND r.stato IN ('APPROVATO','INVIATO')", [req.params.id, req.prof.id]);
  if (!x) throw notFound(); res.json(x);
}));
// Bacheca
r.get('/posizioni', ah(async (req, res) => {
  const sm = await sediMap();
  const rows = await many(`SELECT po.*, c.stato AS mia_candidatura, c.created_at AS candidato_at FROM posizioni po LEFT JOIN candidature c ON c.posizione_id=po.id AND c.prof_id=$1 WHERE po.stato='APERTA' OR c.id IS NOT NULL ORDER BY (po.stato='APERTA') DESC, po.created_at DESC`, [req.prof.id]);
  res.json(rows.map((x) => ({ ...x, sede: x.sede_id ? sm[x.sede_id] || x.sede_id : 'qualsiasi sede' })));
}));
r.post('/posizioni/:id/candidati', ah(async (req, res) => {
  const po = await one("SELECT id FROM posizioni WHERE id=$1 AND stato='APERTA'", [req.params.id]); if (!po) throw notFound('Posizione non più aperta');
  const nota = String(req.body?.nota || '').slice(0, 500);
  await q('INSERT INTO candidature (posizione_id, prof_id, nota) VALUES ($1,$2,$3) ON CONFLICT (posizione_id, prof_id) DO UPDATE SET nota=$3, stato=\'INVIATA\', created_at=now()', [po.id, req.prof.id, nota || null]);
  await audit(req, 'CANDIDATURA', 'posizioni', po.id); res.status(201).json({ ok: true });
}));
r.delete('/posizioni/:id/candidati', ah(async (req, res) => { await q("DELETE FROM candidature WHERE posizione_id=$1 AND prof_id=$2 AND stato='INVIATA'", [req.params.id, req.prof.id]); res.json({ ok: true }); }));

export default r;
