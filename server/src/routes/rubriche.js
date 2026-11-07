// Rubriche esterne (/api/rubriche): ricerca nei contatti Outlook di francesco.epifani@ e nella rubrica Google di fraepi@gmail.com
// per compilare i referenti delle Legal entity (richiesta del CEO del 07/11/2026). Regole di accesso (docs/RUBRICHE.md):
// - ricerca e stato: utenti interni con il Business Hub (qualunque profilo) oppure amministratori della Suite; mai gli esterni;
// - prova, impostazioni, collegamento e scollegamento dell'account Google: amministratori (Owner/Admin). Il consenso Google è
//   personale: l'account che lo dà deve essere quello impostato (predefinito fraepi@gmail.com), altrimenti non si salva nulla.
// Nessun dato delle rubriche si copia nella Suite da qui: il form salva solo il contatto scelto. Audit RUBRICA_CERCA con la query
// troncata a 40 caratteri e le email mascherate; nessuna email in chiaro nei log.
import { Router } from 'express';
import { z } from 'zod';
import { ah, bad, forbidden, audit, parse } from '../lib/util.js';
import { isAdmin, requireAdmin } from '../lib/access.js';
import { isInternal } from '../lib/audience.js';
import {
  stato, cercaEsterne, cercaSuite, cercaPerEmail, provaOutlook, provaGoogle, impostazioni, salvaImpostazioni, urlConsensoGoogle,
  scambiaCodeGoogle, salvaGoogle, revocaGoogle, googleCredenziali, nuovoState, queryPerAudit, mascheraEmail, mockAttivo,
} from '../lib/rubriche.js';

const r = Router();

const conBusiness = (u) => isAdmin(u) || Boolean(u?.grants?.business);
// Interni con il Business Hub o amministratori: chi inserisce i referenti
function richiediUso(req, _res, next) {
  const u = req.user;
  if (!u || u.is_external === true || !isInternal(u)) return next(forbidden('Rubriche esterne riservate al personale interno'));
  if (!conBusiness(u)) return next(forbidden('Rubriche esterne disponibili a chi ha il Business Hub o agli amministratori'));
  next();
}

r.get('/stato', richiediUso, ah(async (req, res) => {
  const s = await stato();
  // ai non amministratori basta sapere se la fonte c'è: niente indirizzo di redirect, né account atteso
  if (!isAdmin(req.user)) {
    delete s.google.redirect_uri; delete s.google.account_atteso;
  }
  res.json({ ...s, puo_amministrare: isAdmin(req.user) });
}));

const MIN_Q = 2;
r.get('/cerca', richiediUso, ah(async (req, res) => {
  const testo = String(req.query.q || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (testo.length < MIN_Q) throw bad(`Scrivi almeno ${MIN_Q} caratteri`);
  const conSuite = req.query.suite !== '0';
  const [esterne, suite] = await Promise.all([
    cercaEsterne(testo),
    conSuite ? cercaSuite(testo, { conBusiness: conBusiness(req.user) }).catch(() => []) : Promise.resolve([]),
  ]);
  const conteggi = { suite: suite.length, outlook: esterne.risultati.outlook.length, google: esterne.risultati.google.length };
  // l'audit si scrive solo quando la ricerca ha davvero interrogato almeno una rubrica esterna (non per le risposte dalla cache)
  if (esterne.interrogate.length) await audit(req, 'RUBRICA_CERCA', { entity: 'rubriche', label: queryPerAudit(testo), data: { q: queryPerAudit(testo), risultati: conteggi, errori: Object.keys(esterne.errori) } });
  res.json({ q: testo, suite, outlook: esterne.risultati.outlook, google: esterne.risultati.google, errori: esterne.errori, conteggi });
}));

// Email scritta a mano: c'è già in Outlook (o in Gmail)? Restituisce il contatto per completare gli altri campi
r.get('/email', richiediUso, ah(async (req, res) => {
  const e = String(req.query.indirizzo || '').trim().toLowerCase().slice(0, 200);
  const { contatto, interrogate } = await cercaPerEmail(e).catch(() => ({ contatto: null, interrogate: [] }));
  if (interrogate.length) await audit(req, 'RUBRICA_CERCA', { entity: 'rubriche', label: queryPerAudit(e), data: { q: queryPerAudit(e), per_email: true, trovato: Boolean(contatto) } });
  res.json({ trovato: contatto || null });
}));

// ---- Amministrazione
r.put('/impostazioni', requireAdmin, ah(async (req, res) => {
  const d = parse(z.object({ outlook_casella: z.string().trim().max(200).optional(), google_account: z.string().trim().max(200).optional() }), req.body);
  for (const v of [d.outlook_casella, d.google_account]) if (v && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v)) throw bad('Indirizzo email non valido');
  const s = await salvaImpostazioni(d, req.user.id);
  await audit(req, 'RUBRICA_IMPOSTAZIONI', { entity: 'rubriche', data: { outlook_casella: s.outlook_casella, google_account: mascheraEmail(s.google_account) } });
  res.json(s);
}));
r.post('/outlook/prova', requireAdmin, ah(async (_req, res) => { res.json(await provaOutlook()); }));
r.post('/google/prova', requireAdmin, ah(async (_req, res) => { res.json(await provaGoogle()); }));

const tornaImpostazioni = (res, esito, motivo) => res.redirect(`/admin/settings?rubriche_google=${esito}${motivo ? `&motivo=${encodeURIComponent(String(motivo).slice(0, 300))}` : ''}#rubriche`);

// Avvio del consenso: solo amministratori, nella stessa sessione che riceverà il callback
r.get('/google/avvia', ah(async (req, res) => {
  if (!isAdmin(req.user)) return tornaImpostazioni(res, 'errore', 'Il collegamento dell\'account Google è riservato agli amministratori');
  if (mockAttivo()) return tornaImpostazioni(res, 'errore', 'Modalità di prova (RUBRICHE_MOCK=1): nessun collegamento reale');
  const { clientId, clientSecret } = googleCredenziali();
  if (!clientId || !clientSecret) return tornaImpostazioni(res, 'errore', 'Credenziali OAuth Google assenti: su Render servono GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET');
  const state = nuovoState();
  req.session.rubricheGoogle = { state, userId: req.user.id, exp: Date.now() + 10 * 60_000 };
  const { google_account } = await impostazioni();
  req.session.save(() => res.redirect(urlConsensoGoogle(state, google_account)));
}));

r.get('/google/callback', ah(async (req, res) => {
  const attesa = req.session.rubricheGoogle;
  delete req.session.rubricheGoogle;
  if (!isAdmin(req.user)) return tornaImpostazioni(res, 'errore', 'Collegamento riservato agli amministratori');
  if (!attesa || attesa.userId !== req.user.id || Date.now() > attesa.exp || typeof req.query.state !== 'string' || req.query.state !== attesa.state) {
    return tornaImpostazioni(res, 'errore', 'Richiesta di collegamento scaduta o non valida: riprova da Impostazioni');
  }
  if (req.query.error) return tornaImpostazioni(res, 'errore', req.query.error === 'access_denied' ? 'Consenso negato su Google' : `Google: ${String(req.query.error)}`);
  if (typeof req.query.code !== 'string' || !req.query.code) return tornaImpostazioni(res, 'errore', 'Google non ha restituito il codice del consenso');
  let dati;
  try { dati = await scambiaCodeGoogle(req.query.code); } catch (e) { return tornaImpostazioni(res, 'errore', e.message); }
  const { google_account: atteso } = await impostazioni();
  if (atteso && dati.account && dati.account !== atteso) {
    // account diverso da quello della rubrica: non si salva e si revoca subito il consenso appena dato
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(dati.refresh_token)}`, { method: 'POST', signal: AbortSignal.timeout(8000) }).catch(() => null);
    await audit(req, 'RUBRICA_GOOGLE_RIFIUTATA', { entity: 'rubriche', data: { account: mascheraEmail(dati.account) } });
    return tornaImpostazioni(res, 'errore', `Hai dato il consenso con ${mascheraEmail(dati.account)}, ma la rubrica impostata è ${mascheraEmail(atteso)}: accedi a Google con l'account giusto e riprova`);
  }
  await salvaGoogle(dati, req.user.id);
  await audit(req, 'RUBRICA_GOOGLE_COLLEGATA', { entity: 'rubriche', data: { account: mascheraEmail(dati.account) } });
  tornaImpostazioni(res, 'ok');
}));

r.post('/google/revoca', requireAdmin, ah(async (req, res) => {
  const out = await revocaGoogle();
  await audit(req, 'RUBRICA_GOOGLE_SCOLLEGATA', { entity: 'rubriche', data: out });
  res.json(out);
}));

export default r;
