// Collegamento bancario (Enable Banking, lib/banca.js): stato, elenco delle banche, avvio del consenso, ritorno dalla banca,
// sincronizzazione a richiesta, movimenti. Autorizzare o staccare un conto: titolare, CEO e CFO (Finance Management o Recupero
// Crediti). Vedere conti e movimenti: anche Finance Support e Amministrazione dei crediti.
import { Router } from 'express';
import { z } from 'zod';
import { ah, bad, audit, parse, forbidden } from '../lib/util.js';
import { requireAuth } from '../lib/access.js';
import { one, many, q } from '../db.js';
import { config } from '../config.js';
import { intestazioniUtente, statoBanca, elencoBanche, avviaCollegamento, completaCollegamento, sincronizzaBanca, scollega, puoGestireBanca, puoVedereBanca, bancaConfigurata } from '../lib/banca.js';

const r = Router();
r.use(requireAuth);
const vede = (req, _res, next) => (puoVedereBanca(req.user) ? next() : next(forbidden('Conti e movimenti bancari: riservati a CEO, CFO, Finance Support e Amministrazione')));
const gestisce = (req, _res, next) => (puoGestireBanca(req.user) ? next() : next(forbidden('Collegare o staccare un conto bancario: riservato a CEO e CFO')));
const errore = (e) => Object.assign(new Error(e.message), { status: e.status && e.status < 500 ? e.status : 502 });

r.get('/stato', vede, ah(async (req, res) => res.json({ ...(await statoBanca()), puo_gestire: puoGestireBanca(req.user) })));
r.get('/banche', gestisce, ah(async (req, res) => { try { res.json(await elencoBanche(String(req.query.paese || 'IT').toUpperCase().slice(0, 2))); } catch (e) { throw errore(e); } }));
r.post('/collega', gestisce, ah(async (req, res) => {
  const b = parse(z.object({ banca: z.string().min(2).max(120), paese: z.string().length(2).default('IT'), psu_type: z.enum(['business', 'personal']).default('business'), max_giorni: z.number().int().min(1).max(365).nullable().optional() }), req.body);
  if (!bancaConfigurata()) throw bad('Enable Banking non configurato: servono ENABLEBANKING_APP_ID e ENABLEBANKING_PRIVATE_KEY nelle variabili d\'ambiente del server');
  let out; try { out = await avviaCollegamento({ banca: b.banca, paese: b.paese.toUpperCase(), psuType: b.psu_type, maxGiorni: b.max_giorni ?? null, userId: req.user.id }); } catch (e) { throw errore(e); }
  await audit(req, 'BANCA_COLLEGAMENTO_AVVIATO', { entity: 'bank_connection', entityId: out.id, label: `Collegamento bancario avviato: ${b.banca}` });
  res.json(out);
}));
// Ritorno dalla banca (indirizzo registrato nell'applicazione Enable Banking): chiude il giro e riporta alla pagina dei conti
r.get('/ritorno', gestisce, ah(async (req, res) => {
  let esito = 'ok';
  try {
    const out = await completaCollegamento({ state: req.query.state, code: req.query.code, error: req.query.error || req.query.error_description });
    if (!out.gia) { await audit(req, 'BANCA_COLLEGATA', { entity: 'bank_connection', entityId: out.id, label: `Conto bancario collegato: ${out.conti} conti` }); sincronizzaBanca({ psu: intestazioniUtente(req) }).catch((e) => console.warn('[banca] prima lettura:', e.message)); }
  } catch (e) { esito = encodeURIComponent(e.message.slice(0, 160)); }
  // si torna alla pagina dei conti del widget che la persona può aprire (Finance Management, altrimenti Recupero Crediti)
  const pagina = req.user.level === 'OWNER' || req.user.grants?.finance ? '/finance/banca' : '/crediti/banca';
  res.redirect(`${config.baseUrl}${pagina}?collegamento=${esito}`);
}));
r.post('/sincronizza', vede, ah(async (req, res) => { const out = await sincronizzaBanca({ psu: intestazioniUtente(req) }); await audit(req, 'BANCA_SINCRONIZZATA', { entity: 'bank', label: `Movimenti bancari letti: ${out.nuovi ?? 0} nuovi` }); res.json(out); }));
r.delete('/collegamenti/:id', gestisce, ah(async (req, res) => {
  if (!(await scollega(req.params.id))) throw bad('Collegamento inesistente');
  await audit(req, 'BANCA_SCOLLEGATA', { entity: 'bank_connection', entityId: Number(req.params.id), label: 'Conto bancario scollegato' });
  res.json({ ok: true });
}));
r.put('/conti/:id', gestisce, ah(async (req, res) => {
  const b = parse(z.object({ attivo: z.boolean().optional(), name: z.string().max(120).optional(), organization_id: z.number().int().nullable().optional() }), req.body);
  const c = await one('UPDATE bank_accounts SET attivo=coalesce($2,attivo), name=coalesce($3,name), organization_id=CASE WHEN $5 THEN $4::int ELSE organization_id END WHERE id=$1 RETURNING id', [Number(req.params.id), b.attivo ?? null, b.name ?? null, b.organization_id ?? null, b.organization_id !== undefined]);
  if (!c) throw bad('Conto inesistente');
  res.json({ ok: true });
}));
// Movimenti: filtro per conto, periodo, segno, testo; al più 500 righe
r.get('/movimenti', vede, ah(async (req, res) => {
  const P = []; const W = []; const p = (v) => { P.push(v); return `$${P.length}`; };
  const g = /^\d{4}-\d{2}-\d{2}$/;
  if (req.query.iban) W.push(`t.iban = ${p(String(req.query.iban))}`);
  if (g.test(String(req.query.da || ''))) W.push(`t.booking_date >= ${p(req.query.da)}`);
  if (g.test(String(req.query.a || ''))) W.push(`t.booking_date <= ${p(req.query.a)}`);
  if (req.query.segno === 'entrate') W.push('t.importo > 0'); else if (req.query.segno === 'uscite') W.push('t.importo < 0');
  if (req.query.q) W.push(`(t.controparte ILIKE '%' || ${p(String(req.query.q).slice(0, 80))} || '%' OR t.causale ILIKE '%' || $${P.length} || '%')`);
  const righe = await many(`SELECT t.id, t.iban, t.booking_date::text AS data, t.value_date::text AS valuta, t.importo, t.currency, t.stato, t.controparte, t.controparte_iban, t.causale
      FROM bank_transactions t ${W.length ? `WHERE ${W.join(' AND ')}` : ''} ORDER BY t.booking_date DESC, t.id DESC LIMIT 500`, P);
  res.json({ righe });
}));

export default r;
