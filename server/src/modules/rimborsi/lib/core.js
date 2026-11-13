// Rimborso Spese · funzioni comuni: impostazioni, perimetro dei dipendenti e organigramma, contesto dell'utente (ruoli calcolati),
// caricamento della nota con righe e allegati, ricalcolo dei totali, eventi, notifiche (Suite ed email).
// Ruoli (nessun grant da assegnare): DIPENDENTE = le proprie note; RESPONSABILE = chi ha riporti diretti nell'organigramma (approva le
// loro note, vede in sola lettura quelle dei livelli sotto); P&C = persone con il grant ADMIN di Contratti del personale oppure elencate
// nell'impostazione pc_person_ids, purché dipendenti (liquidazione, archivio completo, impostazioni); TITOLARE = livello OWNER della Suite
// (vede tutto, in sola lettura sulle note altrui salvo sia il responsabile).
import { q, one, many } from '../db.js';
import { config, KEY } from '../config.js';
import { notify } from '../../../lib/community.js';
import { sendMail, layout } from '../../../lib/mailer.js';
import { forbidden, notFound, today } from '../../../lib/util.js';
import { isDipendente, DIPENDENTI_KINDS, DIPENDENTI_STATI } from '../../../lib/access.js';
import { getModuleState } from '../../../lib/modules.js';
import { approvatore, discendenti, figliDi } from './organigramma.js';
import { riepilogo, azioni, nomeMese, eur, itData } from './calcoli.js';
import { assegnazioniPersona, mascheraNumero, numeroLeggibile, attivaIl } from '../../contracts/lib/benefitAuto.js';

export { KEY };
export const oggi = () => today();
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------------------------------------------------------------- impostazioni (predefiniti dichiarati in docs/RIMBORSI.md)
export const DEFAULTS = {
  giorno_limite: 10,                  // invio entro il giorno N del mese successivo; oltre: consentito con avviso "in ritardo"
  // Tariffa UNICA aziendale decisa dal CEO il 13/11/2026: 0,42 EUR/km per tutti i veicoli propri (non la tariffa ACI del singolo modello).
  tariffa_km_default: 0.42,
  tariffa_km_default_fonte: 'Tariffa unica aziendale (decisione della Direzione, 13/11/2026)',
  tariffa_km_unica: true,             // true: vale sempre la tariffa unica, la tariffa del veicolo non conta; false: tariffa del veicolo, poi la predefinita
  pc_person_ids: [],                  // P&C in più rispetto al grant ADMIN di Contratti del personale (devono essere dipendenti)
  // Invio del PDF di approvazione (CEO, 13/11/2026): a ogni approvazione parte verso destinatari ESTERNI all'azienda (consulente del
  // lavoro) un documento con i dati di spesa del dipendente. Seme = i due indirizzi indicati dal CEO; P&C e titolare li cambiano.
  invio_approvazione_attivo: true,
  mittente_approvazione: 'people@toscanadiagnostica.it',
  destinatari_approvazione: [
    { nome: 'Poggiali Angela', email: 'a.poggiali@confindustriaservizicentroecosta.it' },
    { nome: 'Caiani Matteo', email: 'm.caiani@confindustriaservizicentroecosta.it' },
  ],
  allega_giustificativi: false,       // solo il PDF della nota; con sì anche i giustificativi
  promemoria_bozza_giorni_prima: 3,   // promemoria al dipendente dal giorno N-3
  promemoria_responsabile_giorni: 5,  // note in attesa del responsabile da più di 5 giorni
  email_attiva: true,                 // email oltre alla notifica nella Suite (solo agli utenti con email e notify_email)
  risali_se_in_ferie: true,           // responsabile in ferie oggi (Piano Ferie): la nota sale al superiore successivo
  avviso_dipendenti: '',              // testo libero mostrato in "Le mie note spese"
};
export async function settings() {
  const rows = await many('SELECT key, value FROM impostazioni');
  return { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}
export async function setSetting(key, value) {
  await q('INSERT INTO impostazioni (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()', [key, JSON.stringify(value)]);
}

// ---------------------------------------------------------------- perimetro e organigramma (cache 30 secondi)
let cache = { at: 0, data: null };
export const invalidaPerimetro = () => { cache = { at: 0, data: null }; };

async function inFerieOggi(giorno) {
  try {
    if ((await getModuleState('ferie')).mode !== 'LIVE') return new Set();
    return new Set((await many(`SELECT DISTINCT person_id FROM ferie.richieste WHERE tipo = 'FERIE' AND stato IN ('APPROVATA','GODUTA') AND $1::date BETWEEN data_inizio AND data_fine`, [giorno])).map((r) => r.person_id));
  } catch { return new Set(); }
}

/** Dipendenti (perimetro del modulo) e nodi della catena dei superiori: { persone: Map, nodi: Map, figli: Map } */
export async function perimetro() {
  if (cache.data && Date.now() - cache.at < 30_000) return cache.data;
  const s = await settings();
  const persone = await many(`SELECT p.id, p.last_name, p.first_name, p.kind, p.status, p.site_id, p.email, s.name AS site_name, jr.name AS role_name, ou.name AS unit_name,
        (SELECT u.id FROM public.users u WHERE u.person_id = p.id AND u.status = 'ACTIVE' ORDER BY u.id LIMIT 1) AS user_id
      FROM public.people p LEFT JOIN public.sites s ON s.id = p.site_id LEFT JOIN public.job_roles jr ON jr.id = p.role_id LEFT JOIN public.org_units ou ON ou.id = p.unit_id
     WHERE p.kind = ANY($1::text[]) AND p.status = ANY($2::text[]) ORDER BY lower(p.last_name), lower(p.first_name)`, [DIPENDENTI_KINDS, DIPENDENTI_STATI]);
  const ids = persone.map((p) => p.id);
  const ferie = s.risali_se_in_ferie !== false ? await inFerieOggi(oggi()) : new Set();
  const rows = ids.length ? await many(`WITH RECURSIVE c(id) AS (SELECT unnest($1::int[]) UNION SELECT public.people_manager(c.id) FROM c WHERE public.people_manager(c.id) IS NOT NULL)
      SELECT p.id, p.last_name || ' ' || p.first_name AS nome, p.status, p.kind, public.people_manager(p.id) AS manager_id,
        (SELECT u.id FROM public.users u WHERE u.person_id = p.id AND u.status = 'ACTIVE' ORDER BY u.id LIMIT 1) AS user_id
      FROM public.people p WHERE p.id IN (SELECT id FROM c)`, [ids]) : [];
  const nodi = new Map(rows.map((r) => [r.id, { id: r.id, nome: r.nome, manager_id: r.manager_id, attivo: r.status === 'ATTIVO', dipendente: DIPENDENTI_KINDS.includes(r.kind), user_id: r.user_id, in_ferie: ferie.has(r.id) }]));
  const out = new Map();
  for (const p of persone) {
    const ap = approvatore(p.id, nodi);
    out.set(p.id, { ...p, nome: `${p.last_name} ${p.first_name}`.trim(), ...ap });
  }
  const data = { persone: out, nodi, figli: figliDi(nodi) };
  cache = { at: Date.now(), data };
  return data;
}

/** Persone P&C: grant ADMIN di Contratti del personale (collegato a una persona) più l'impostazione pc_person_ids; solo dipendenti */
export async function personePc(perim, s) {
  const daGrant = (await many(`SELECT DISTINCT u.person_id FROM public.grants g JOIN public.users u ON u.id = g.user_id
      WHERE g.module_key = 'contracts' AND g.profile = 'ADMIN' AND NOT g.proposed AND u.status = 'ACTIVE' AND u.person_id IS NOT NULL`)).map((r) => r.person_id);
  const ids = [...new Set([...daGrant, ...(s.pc_person_ids || []).map(Number)])];
  return new Set(ids.filter((id) => perim.persone.has(id)));
}

/** Eccezione al giustificativo obbligatorio per la persona */
export async function haEccezione(personId) {
  return Boolean(await one('SELECT 1 FROM eccezioni WHERE person_id=$1', [personId]));
}

// ---------------------------------------------------------------- contesto
/** Middleware: SOLO dipendenti (people.kind DIPENDENTE, stato ATTIVO o IMPEGNO). Nessun altro, amministratori compresi. */
export function soloDipendenti(req, _res, next) {
  if (!isDipendente(req.user)) return next(forbidden('Il Rimborso Spese è riservato ai dipendenti di Toscana Diagnostica'));
  next();
}

export async function userContext(req) {
  if (req.rimbCtx) return req.rimbCtx;
  req.rimbCtx = await contesto(req.user);
  return req.rimbCtx;
}

export async function contesto(user) {
  const s = await settings();
  const perim = await perimetro();
  const personId = user.person_id || null;
  const me = personId ? perim.persone.get(personId) || null : null;
  const pc = await personePc(perim, s);
  const isPC = Boolean(me) && pc.has(personId);
  const isTitolare = Boolean(me) && user.level === 'OWNER';
  // diretti: dipendenti il cui approvatore effettivo (con la risalita) sono io
  const diretti = new Set([...perim.persone.values()].filter((p) => p.approvatore_id === personId && p.id !== personId).map((p) => p.id));
  const catena = new Set(personId ? discendenti(personId, perim.nodi, perim.figli).filter((id) => id !== personId) : []);
  for (const id of diretti) catena.add(id);
  const tutto = isPC || isTitolare;
  return {
    user, uid: user.id, personId, me, perim, settings: s, pc, isPC, isTitolare, tutto, diretti, catena,
    isResponsabile: diretti.size > 0,
    /** può vedere la nota (e i suoi giustificativi): la propria; P&C e titolare tutte; il responsabile quelle dei riporti (diretti e, in sola
     *  lettura, indiretti) e quelle a lui inviate, ma non le bozze mai inviate (la bozza è del dipendente finché non la manda) */
    vede: (n) => Boolean(n) && (n.person_id === personId || tutto || ((n.stato !== 'BOZZA' || Boolean(n.inviata_at)) && (n.responsabile_person_id === personId || catena.has(n.person_id)))),
    /** ruolo sulla nota per le azioni */
    ruolo: (n) => ({ proprietario: n.person_id === personId, responsabile: n.responsabile_person_id === personId && n.person_id !== personId, pc: isPC, titolare: isTitolare }),
  };
}

// ---------------------------------------------------------------- nota
export const NOTA_COLS = `n.*, p.last_name || ' ' || p.first_name AS persona, p.kind AS persona_kind, p.site_id AS persona_site_id,
  r.last_name || ' ' || r.first_name AS responsabile_nome, au.full_name AS approvata_da_nome, lu.full_name AS liquidata_da_nome, iu.full_name AS inviata_da_nome,
  ap.last_name || ' ' || ap.first_name AS approvata_persona_nome`;
export const NOTA_FROM = `note n JOIN public.people p ON p.id = n.person_id LEFT JOIN public.people r ON r.id = n.responsabile_person_id
  LEFT JOIN public.users au ON au.id = n.approvata_da LEFT JOIN public.users lu ON lu.id = n.liquidata_da LEFT JOIN public.users iu ON iu.id = n.inviata_da
  LEFT JOIN public.people ap ON ap.id = n.approvata_person_id`;

export async function caricaNota(id) {
  return one(`SELECT ${NOTA_COLS} FROM ${NOTA_FROM} WHERE n.id=$1`, [id]);
}
/** Nota visibile all'utente, altrimenti 404 (non si rivela l'esistenza delle note altrui) */
export async function notaVisibile(ctx, id) {
  const n = await caricaNota(Number(id));
  if (!n || !ctx.vede(n)) throw notFound('Nota spese non trovata');
  return n;
}

export async function categorieMap() {
  return new Map((await many('SELECT * FROM categorie ORDER BY ordine, id')).map((c) => [c.id, c]));
}

export async function righe(notaId) {
  const spese = await many(`SELECT s.*, c.nome AS categoria, c.codice AS categoria_codice, c.tipo AS categoria_tipo, o.name AS cliente, eu.full_name AS esclusa_da_nome
      FROM spese s JOIN categorie c ON c.id = s.categoria_id LEFT JOIN public.organizations o ON o.id = s.cliente_org_id LEFT JOIN public.users eu ON eu.id = s.esclusa_da
     WHERE s.nota_id=$1 ORDER BY s.data, s.id`, [notaId]);
  const viaggi = await many(`SELECT v.*, o.name AS cliente, eu.full_name AS esclusa_da_nome FROM viaggi v LEFT JOIN public.organizations o ON o.id = v.cliente_org_id LEFT JOIN public.users eu ON eu.id = v.esclusa_da
     WHERE v.nota_id=$1 ORDER BY v.data, v.id`, [notaId]);
  const allegati = await many(`SELECT a.id, a.riga_tipo, a.riga_id, a.filename, a.mime, a.size, a.sha256, a.larghezza, a.altezza, a.caricato_at, u.full_name AS caricato_da_nome
      FROM allegati a LEFT JOIN public.users u ON u.id = a.caricato_da WHERE a.nota_id=$1 ORDER BY a.id`, [notaId]);
  return { spese, viaggi, allegati };
}

/** Ricalcola e salva i totali della nota (dentro una transazione se `c` è dato) */
export async function ricalcola(notaId, c = null) {
  const run = c ? c.query.bind(c) : q;
  const n = (await run('SELECT anticipi FROM note WHERE id=$1', [notaId])).rows[0];
  if (!n) return null;
  const spese = (await run('SELECT s.importo, s.metodo, s.esclusa, s.categoria_id, c.tipo AS categoria_tipo FROM spese s JOIN categorie c ON c.id = s.categoria_id WHERE s.nota_id=$1', [notaId])).rows;
  const viaggi = (await run('SELECT km, andata_ritorno, tariffa, rimborsabile, veicolo_tipo, esclusa FROM viaggi WHERE nota_id=$1', [notaId])).rows;
  const t = riepilogo({ spese, viaggi, anticipi: n.anticipi });
  await run(`UPDATE note SET tot_spese=$2, tot_km=$3, tot_km_importo=$4, tot_pedaggi=$5, tot_parcheggi=$6, tot_carta=$7, tot_escluso=$8, tot_rimborsabile=$9, saldo=$10, updated_at=now() WHERE id=$1`,
    [notaId, t.tot_spese, t.tot_km, t.tot_km_importo, t.tot_pedaggi, t.tot_parcheggi, t.tot_carta, t.tot_escluso, t.tot_rimborsabile, t.saldo]);
  return t;
}

export async function evento(notaId, tipo, { userId = null, personId = null, testo = null, dati = {} } = {}, c = null) {
  const run = c ? c.query.bind(c) : q;
  await run('INSERT INTO eventi (nota_id, tipo, user_id, person_id, testo, dati) VALUES ($1,$2,$3,$4,$5,$6)', [notaId, tipo, userId, personId, testo, JSON.stringify(dati || {})]);
}

// ---------------------------------------------------------------- vetture aziendali e fuel card (da Contratti del personale)
/**
 * Assegnazioni della persona lette da Contratti del personale (API interna lib/benefitAuto.js). Il numero della carta è per intero solo
 * per P&C, titolare e l'assegnatario; per gli altri (il responsabile) mascherato.
 */
export async function benefitPersona(personId, { pieno = false, giorno = oggi() } = {}) {
  const a = await assegnazioniPersona(personId).catch(() => ({ disponibile: false, vetture: [], fuel_card: [] }));
  return {
    disponibile: a.disponibile,
    vetture: a.vetture.map((v) => ({ id: v.id, marca: v.marca, modello: v.modello, targa: v.targa, alimentazione: v.alimentazione, dal: v.dal, al: v.al, uso_promiscuo: v.uso_promiscuo, in_corso: attivaIl(v, giorno) })),
    fuel_card: a.fuel_card.map((f) => ({ id: f.id, circuito: f.circuito, numero: pieno ? numeroLeggibile(f.numero) : mascheraNumero(f.numero), numero_mascherato: mascheraNumero(f.numero),
      dal: f.dal, al: f.al, vettura_id: f.vettura_id, vettura_targa: f.vettura_targa, in_corso: attivaIl(f, giorno) })),
  };
}
/** Vettura aziendale in corso in una data qualunque del mese (la sezione chilometri diventa registro) */
export const vetturaNelMese = (vetture, anno, mese) => vetture.find((v) => {
  const ini = `${anno}-${String(mese).padStart(2, '0')}-01`, fine = `${anno}-${String(mese).padStart(2, '0')}-31`;
  return String(v.dal) <= fine && (!v.al || String(v.al) >= ini);
}) || null;

// ---------------------------------------------------------------- notifiche
export async function utentiDiPersone(personIds) {
  const ids = [...new Set((personIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return [];
  return (await many(`SELECT id FROM public.users WHERE status='ACTIVE' AND person_id = ANY($1::int[])`, [ids])).map((r) => r.id);
}

/** Notifica nella Suite e, con email_attiva (predefinito sì), email agli utenti con indirizzo e notify_email */
export async function notifica(userIds, { title, body = null, link, ref, exclude = [] }) {
  const ids = [...new Set((userIds || []).map(Number).filter((x) => Number.isInteger(x) && !exclude.includes(x)))];
  if (!ids.length) return 0;
  await notify(ids, { kind: 'RIMBORSI', module_key: KEY, title: String(title).slice(0, 200), body, link });
  const s = await settings();
  if (s.email_attiva !== false) {
    const users = await many(`SELECT id, email FROM public.users WHERE id = ANY($1::int[]) AND status='ACTIVE' AND notify_email AND email IS NOT NULL`, [ids]);
    const html = layout('Rimborso Spese', `<p><b>${escapeHtml(title)}</b></p>${body ? `<p>${escapeHtml(body)}</p>` : ''}<p><a href="${config.baseUrl}${link}">Apri il Rimborso Spese nella Suite</a></p>`);
    for (const u of users) {
      try { await sendMail({ to: u.email, subject: `Rimborso Spese: ${title}`, html, ref }); } catch (e) { console.error('[rimborsi:mail]', e.message); }
    }
  }
  return ids.length;
}

export const titoloNota = (n) => `nota spese di ${nomeMese(n.anno, n.mese)}`;
export const linkNota = (n) => `/rimborsi/nota/${n.id}`;

/** Vista della nota per il client: totali, azioni, regole di visibilità del numero di carta */
export function vistaNota(n, ctx) {
  const ruolo = ctx.ruolo(n);
  return { ...n, azioni: azioni(n, ruolo), sola_lettura: !ruolo.proprietario && !Object.values(azioni(n, ruolo)).some(Boolean), mia: ruolo.proprietario };
}

export { eur, itData, nomeMese };
