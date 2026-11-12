// Guida GIPO · funzioni comuni: profilo dell'utente, accesso riservato agli interni, coda della redazione, contatore della Home, riepilogo
// settimanale agli amministratori, "Apri in GIPO".
import { q, one, many } from '../db.js';
import { forbidden } from '../../../lib/util.js';
import { isExternal } from '../../../lib/esterni.js';
import { getModuleState } from '../../../lib/modules.js';
import { notify } from '../../../lib/community.js';
import { KEY, config } from '../config.js';

export { KEY };

/** Contesto: ADMIN (grant ADMIN, oppure Owner/Admin della Suite senza grant) = redazione; LETTORE = consultazione, domande. */
export function contesto(req) {
  const mu = req.moduleUser || {};
  return { isAdmin: mu.role === 'ADMIN', role: mu.role || 'LETTORE', userId: req.user?.id || null };
}
export function soloAdmin(req, _res, next) {
  if (contesto(req).isAdmin) return next();
  return next(forbidden('Sezione riservata alla redazione della Guida GIPO'));
}
/** Gli accessi esterni (clienti service, partner) non vedono la guida, salvo un grant esplicito: è uno strumento del personale */
export function soloInterni(req, _res, next) {
  if (isExternal(req.user) && !req.user.grants?.[KEY]) return next(forbidden('La Guida GIPO è riservata al personale di Toscana Diagnostica'));
  next();
}

// ---------------------------------------------------------------- impostazioni (chiave → JSON)
export async function leggiImpostazione(key, fallback = null) {
  const r = await one('SELECT value FROM impostazioni WHERE key = $1', [key]);
  return r ? r.value : fallback;
}
export async function scriviImpostazione(key, value) {
  await q('INSERT INTO impostazioni (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [key, JSON.stringify(value)]);
}

// ---------------------------------------------------------------- coda della redazione
// In coda: domande senza risposta soddisfacente (SENZA_RISPOSTA, oppure giudicate "non utile" da chi le ha poste), non risolte né chiuse
export const IN_CODA = `d.risolta_il IS NULL AND d.chiusa_il IS NULL AND (d.esito = 'SENZA_RISPOSTA' OR d.utile = FALSE)`;
export async function contaCoda() {
  return (await one(`SELECT count(*)::int AS n FROM domande d WHERE ${IN_CODA}`)).n;
}

/** "Apri in GIPO": solo i percorsi di consultazione (non le pagine di creazione /Create, nuova visita, nuovo DDT...) */
export function apribileInGipo(percorso) {
  const p = String(percorso || '').trim();
  if (!/^\/[A-Za-z0-9/_-]*$/.test(p)) return false;
  return !/create|nuov[aoie]/i.test(p);
}
export const linkGipo = (percorso) => (apribileInGipo(percorso) ? `${config.gipoBase}${percorso}` : null);

/** Numerazione "capitolo.posizione" delle sezioni (posizione nel capitolo per ordine, poi id) */
export const SQL_NUMERO = `s.capitolo || '.' || row_number() OVER (PARTITION BY s.capitolo ORDER BY s.ordine, s.id)`;

// ---------------------------------------------------------------- amministratori del modulo
/** Utenti attivi che sono ADMIN della guida: grant ADMIN, oppure Owner/Admin della Suite senza un grant diverso */
export async function idAmministratori() {
  return (await many(`SELECT u.id FROM public.users u LEFT JOIN public.grants g ON g.user_id = u.id AND g.module_key = $1 AND NOT coalesce(g.proposed, FALSE)
    WHERE u.status = 'ACTIVE' AND (g.profile = 'ADMIN' OR (g.profile IS NULL AND u.level IN ('OWNER', 'ADMIN')))`, [KEY])).map((r) => r.id);
}

/** Contatore della tessera in Home: agli ADMIN della guida il numero di domande da risolvere; agli altri nulla */
export async function contatoreHome(user) {
  if (!user || isExternal(user)) return null;
  const st = await getModuleState(KEY);
  if (st.mode !== 'LIVE') return null;
  const admin = user.grants?.[KEY]?.profile === 'ADMIN' || (!user.grants?.[KEY] && (user.level === 'OWNER' || user.level === 'ADMIN'));
  if (!admin) return null;
  const n = await contaCoda();
  return { value: n, label: n === 1 ? 'domanda da risolvere' : 'domande da risolvere' };
}

// ---------------------------------------------------------------- riepilogo settimanale (job gipoguida:riepilogo)
const settimanaIso = (d) => {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const g = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - g);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t - y0) / 86_400_000 + 1) / 7)).padStart(2, '0')}`;
};
/** Ora di Roma come Date "locale" (giorno della settimana e ora) */
const romaOra = (now) => new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Rome' }));

/**
 * Il lunedì dalle 8 (ora di Roma), una volta per settimana: notifica in app agli amministratori della guida con il numero di domande in coda
 * (meccanismo già pronto della Suite: notifiche; lo scadenzario di direzione e la bacheca non hanno destinatari per modulo). Con la coda
 * vuota non notifica nessuno. forza: subito, senza controllare giorno e settimana (Redazione > "Invia il riepilogo adesso", test).
 */
export async function riepilogoSettimanale({ now = new Date(), forza = false } = {}) {
  const st = await getModuleState(KEY);
  if (st.mode !== 'LIVE') return { saltato: 'modulo non attivo' };
  const r = romaOra(now);
  const settimana = settimanaIso(r);
  if (!forza) {
    if (r.getDay() !== config.riepilogoGiorno || r.getHours() < config.riepilogoOra) return { saltato: 'non è il momento' };
    const ult = await leggiImpostazione('riepilogo', null);
    if (ult?.settimana === settimana) return { saltato: 'già inviato questa settimana' };
  }
  const n = await contaCoda();
  const vecchie = (await one(`SELECT count(*)::int AS n FROM domande d WHERE ${IN_CODA} AND d.creata_il < now() - make_interval(days => $1)`, [config.giorniCodaVecchia])).n;
  let destinatari = 0;
  if (n > 0) {
    const ids = await idAmministratori();
    destinatari = await notify(ids, { kind: 'MODULO', module_key: KEY, title: `Guida GIPO: ${n} ${n === 1 ? 'domanda' : 'domande'} da risolvere`,
      body: `${n === 1 ? 'Una domanda del personale non ha' : `${n} domande del personale non hanno`} ancora una risposta soddisfacente${vecchie ? ` (${vecchie} da oltre ${config.giorniCodaVecchia} giorni)` : ''}. Rispondi dalla Redazione: la risposta diventa una FAQ della guida.`,
      link: '/gipoguida/redazione' });
  }
  await scriviImpostazione('riepilogo', { settimana, at: now.toISOString(), coda: n, vecchie, destinatari });
  return { settimana, coda: n, vecchie, destinatari };
}
