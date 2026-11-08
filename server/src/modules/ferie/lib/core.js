// Funzioni comuni del Piano Ferie: impostazioni, contesto di accesso dell'utente, calendario della persona, saldi, eventi, notifiche.
import { q, one, many } from '../db.js';
import { config } from '../config.js';
import { notify } from '../../../lib/community.js';
import { sendMail, layout } from '../../../lib/mailer.js';
import { isExternal } from '../../../lib/esterni.js';
import { forbidden } from '../../../lib/util.js';
import { today } from '../../../lib/util.js';
import { festiviPer, settimanaDaContratto, contaGiorni } from './calendario.js';
import { spettanza as calcSpettanza, saldo as calcSaldo, avvisiSaldo } from './saldi.js';
import { perimetro, siteDiGruppo } from './perimetro.js';

export const KEY = 'ferie';
// Stati di un periodo (riga di ferie.richieste): PIANIFICATA = periodo di un piano non ancora approvato; RICHIESTA = variazione al piano
// (o permesso ROL) in attesa di decisione singola; APPROVATA = periodo di un piano approvato o definitivo, o variazione approvata;
// GODUTA = approvata con data passata (job); RIFIUTATA (variazione non accolta); ANNULLATA (periodo tolto dal piano dopo l'approvazione).
export const STATI = ['PIANIFICATA', 'RICHIESTA', 'APPROVATA', 'RIFIUTATA', 'GODUTA', 'ANNULLATA'];
export const STATO_LABEL = { PIANIFICATA: 'Nel piano', RICHIESTA: 'Variazione in attesa', APPROVATA: 'Approvata', RIFIUTATA: 'Rifiutata', GODUTA: 'Goduta', ANNULLATA: 'Tolta' };
export const ATTIVI = ['PIANIFICATA', 'RICHIESTA', 'APPROVATA', 'GODUTA'];   // occupano il calendario
export const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const itData = (s) => (s ? `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}/${String(s).slice(0, 4)}` : '');
export const oggi = () => today();

// ---------------------------------------------------------------- impostazioni
// Valori predefiniti dichiarati come ipotesi (docs/FERIE.md): HR li cambia da Impostazioni del modulo
export const DEFAULTS = {
  includi_dirigenti: true,           // i DIRIGENTE con contratto subordinato sono dipendenti a tutti gli effetti
  soglia_mese_giorni: 15,            // un mese conta come lavorato (maturazione pro rata) con almeno 15 giorni di rapporto
  scadenza_ap: '06-30',              // il residuo dell'anno precedente va goduto entro il 30 giugno (avviso)
  mesi_rischio: [10, 11],            // ottobre e novembre: controllo dei residui non pianificati
  soglia_rischio_giorni: 10,         // da quanti giorni non pianificati scatta l'avviso "a rischio"
  promemoria_giorni: 3,              // richieste in attesa da più di N giorni: promemoria all'approvatore
  email_attiva: false,               // email oltre alla notifica in app (con il mittente della Suite, solo agli utenti con email)
  festa_4_ottobre: true,             // 4 ottobre festa nazionale dal 2026
  festivi_aggiunti: [],              // [{ data: 'AAAA-MM-GG', nome }]
  festivi_esclusi: [],               // ['AAAA-MM-GG']
  rol_attivi: false,                 // voce ROL/permessi in ore (facoltativa)
  avviso_dipendenti: '',             // testo mostrato sopra il piano del dipendente
  scadenze_piano: {},                // { 'AAAA': 'AAAA-MM-GG' }: data entro cui i dipendenti inviano il piano di quell'anno (HR, nessun valore predefinito)
  promemoria_scadenza_giorni: 7,     // promemoria ai piani non inviati da N giorni prima della scadenza
};
export async function settings() {
  const rows = await many('SELECT key, value FROM impostazioni');
  return { ...DEFAULTS, ...Object.fromEntries(rows.map((r) => [r.key, r.value])) };
}
export async function setSetting(key, value) {
  await q('INSERT INTO impostazioni (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()', [key, JSON.stringify(value)]);
}

// ---------------------------------------------------------------- contesto di accesso
/**
 * Contesto dell'utente (una volta per richiesta HTTP). Funzionamento stabilito dal CEO (08/11/2026): "Solo l'amministratore vede tutto.
 * Ogni dipendente vede solo la propria area. Il responsabile dell'Area può modificare il piano dei dipendenti dell'area e approvarlo".
 * role: ADMIN (Owner e Admin della Suite, HR solo con il grant ADMIN: tutto) | RESPONSABILE (grant: approva la propria area, o le sedi
 * dell'ambito del grant) | DIPENDENTE (= Utente: compila il proprio piano e vede la propria area; implicito per ogni interno).
 * approva: persone di cui l'utente è responsabile (approvatore dall'organigramma o dal dossier HR, deleghe attive, grant RESPONSABILE),
 * mai sé stesso. areeGestite: aree di quelle persone. Il dipendente vede solo la propria area (nomi e periodi dei colleghi).
 */
export async function userContext(req) {
  if (req.ferieCtx) return req.ferieCtx;
  req.ferieCtx = await contesto(req.user, req.moduleUser?.role || 'DIPENDENTE');
  return req.ferieCtx;
}
/** Area (gruppo) di una sede indicata nell'ambito di un grant: laboratorio → LAB, sede direzionale → DIR, altre → SEDE:<id> */
export function gruppoDiSede(site) {
  if (!site || site.kind === 'SERVICE') return null;
  if (site.kind === 'LABORATORIO') return 'LAB';
  if (site.kind === 'HEADQUARTER') return 'DIR';
  return `SEDE:${site.id}`;
}
/** Contesto per un utente della Suite e un ruolo del modulo (usato anche dal contatore della Home, senza richiesta HTTP) */
export async function contesto(user, role) {
  const s = await settings();
  const perim = await perimetro({ includiDirigenti: s.includi_dirigenti !== false });
  const isAdmin = role === 'ADMIN';
  const isViewer = false;   // il profilo Consultazione non esiste più (CEO, 08/11/2026): chi non è ADMIN né responsabile è Utente della propria area
  const personId = user.person_id || null;
  const me = personId ? perim.persone.get(personId) || null : null;
  const deleganti = personId ? (await many(`SELECT delegante_person_id AS id FROM deleghe WHERE delegato_person_id=$1 AND $2::date BETWEEN dal AND al`, [personId, oggi()])).map((r) => r.id) : [];
  const approvatori = new Set([personId, ...deleganti].filter(Boolean));
  const approva = new Set();
  for (const p of perim.persone.values()) if (p.approvatore_id && approvatori.has(p.approvatore_id) && p.id !== personId) approva.add(p.id);
  // RESPONSABILE (grant): tutta l'area delle sedi dell'ambito del grant; senza ambito, la propria area
  if (role === 'RESPONSABILE') {
    const scopes = (user.grants?.[KEY]?.scopes || []).filter((x) => x.type === 'SITE').map((x) => perim.siti?.get?.(Number(x.id))).filter(Boolean);
    const aree = new Set(scopes.map(gruppoDiSede).filter(Boolean));
    if (!aree.size && me) aree.add(me.gruppo);
    for (const p of perim.persone.values()) if (aree.has(p.gruppo) && p.id !== personId) approva.add(p.id);
  }
  const areeGestite = new Set([...approva].map((id) => perim.persone.get(id)?.gruppo).filter(Boolean));
  const tutto = isAdmin || isViewer;
  const gruppi = new Set(areeGestite);
  if (me) gruppi.add(me.gruppo);
  const ctx = {
    uid: user.id, personId, role, isAdmin, isViewer, tutto, me, perim, settings: s, approva, deleganti, areeGestite,
    isApprovatore: approva.size > 0,
    // aree visibili: ADMIN e VIEWER tutte; gli altri la propria e quelle che gestiscono
    vedeGruppo: (g) => tutto || gruppi.has(g),
    // saldi e note di una persona: ADMIN e VIEWER, la persona stessa, il suo responsabile
    vedeSaldo: (pid) => tutto || pid === personId || approva.has(pid),
    // modifica dei periodi, approvazione, definitivo, riapertura: ADMIN (anche il proprio piano: sopra il CEO non c'è nessuno) e il responsabile
    puoGestire: (pid) => isAdmin || (approva.has(pid) && pid !== personId),
    puoDecidere: (pid) => isAdmin || (approva.has(pid) && pid !== personId),
    gruppi: tutto ? perim.gruppi.map((g) => g.key) : [...gruppi],
  };
  return ctx;
}

/** Middleware: gli accessi esterni (partner, clienti service) non vedono il modulo, salvo un grant esplicito */
export function soloInterni(req, _res, next) {
  if (isExternal(req.user) && !req.user.grants?.[KEY]) return next(forbidden('Il Piano Ferie è riservato al personale di Toscana Diagnostica'));
  next();
}

// ---------------------------------------------------------------- calendario della persona
let patroniCache = { at: 0, map: null };
export async function patroni() {
  if (patroniCache.map && Date.now() - patroniCache.at < 30_000) return patroniCache.map;
  const rows = await many('SELECT site_id, giorno, santo FROM patroni');
  patroniCache = { at: Date.now(), map: new Map(rows.map((r) => [r.site_id, r])) };
  return patroniCache.map;
}
export const invalidaPatroni = () => { patroniCache = { at: 0, map: null }; };

/** Settimana lavorativa e festivi (Map data → nome) della persona per gli anni indicati */
export async function calendarioPersona(p, anni, s) {
  const st = s || (await settings());
  const pat = await patroni();
  const sid = p?.site_id || siteDiGruppo(p?.gruppo);
  const settimana = settimanaDaContratto(p?.contratto && (p.contratto.weekly_days || p.contratto.days_label) ? p.contratto : null);
  const festivi = festiviPer(anni, { patrono: sid ? pat.get(sid) : null, aggiunti: st.festivi_aggiunti, esclusi: st.festivi_esclusi, quattroOttobre: st.festa_4_ottobre !== false });
  return { settimana: settimana.giorni, settimana_etichetta: settimana.etichetta, settimana_fonte: settimana.fonte, festivi, patrono: sid ? pat.get(sid) || null : null };
}

// ---------------------------------------------------------------- spettanza e saldo
export async function spettanzaAnnua(p, anno) {
  const ov = await one('SELECT giorni_annui, rol_ore_annue FROM saldi WHERE person_id=$1 AND anno=$2', [p.id, anno]);
  const ccnl = p.contratto?.ccnl || '*', level = p.contratto?.level || '*';
  const row = await one(`SELECT giorni_annui, rol_ore_annue, ccnl, level FROM spettanze WHERE (ccnl=$1 OR ccnl='*') AND (level=$2 OR level='*')
      ORDER BY (ccnl <> '*') DESC, (level <> '*') DESC LIMIT 1`, [ccnl, String(level)]);
  return {
    giorni_annui: ov?.giorni_annui != null ? Number(ov.giorni_annui) : row ? Number(row.giorni_annui) : 26,
    rol_ore_annue: ov?.rol_ore_annue != null ? Number(ov.rol_ore_annue) : row?.rol_ore_annue != null ? Number(row.rol_ore_annue) : null,
    fonte: ov?.giorni_annui != null ? 'forzatura sul saldo' : row ? (row.ccnl === '*' && row.level === '*' ? 'valore predefinito (ipotesi da verificare)' : `CCNL ${row.ccnl === '*' ? 'qualunque' : row.ccnl}, livello ${row.level === '*' ? 'qualunque' : row.level}`) : 'ipotesi 26 giorni',
  };
}

/**
 * Somma dei giorni dei periodi FERIE del piano, con il calendario della persona: goduto = giorni approvati fino a oggi; pianificato =
 * gli altri giorni del piano (approvati futuri e periodi non ancora approvati); in_attesa = variazioni da decidere.
 */
export function ripartisci(richieste, cal, giorno) {
  let goduto = 0, pianificato = 0, inAttesa = 0, rolGoduto = 0, rolPianificato = 0, rolAttesa = 0;
  for (const r of richieste) {
    if (r.tipo === 'ROL') {
      const ore = Number(r.ore || 0);
      if (r.stato === 'RICHIESTA') rolAttesa += ore;
      else if (['APPROVATA', 'GODUTA'].includes(r.stato)) { if (String(r.data_inizio) <= giorno) rolGoduto += ore; else rolPianificato += ore; }
      continue;
    }
    if (r.stato === 'RICHIESTA') { inAttesa += Number(r.giorni || 0); continue; }
    if (!['PIANIFICATA', 'APPROVATA', 'GODUTA'].includes(r.stato)) continue;
    const c = contaGiorni({ inizio: r.data_inizio, fine: r.data_fine, mezza_inizio: r.mezza_inizio, mezza_fine: r.mezza_fine }, cal);
    // goduto: solo i giorni approvati già passati; i periodi di un piano non ancora approvato restano pianificati anche se passati
    for (const d of c.dettaglio) { if (d.data <= giorno && r.stato !== 'PIANIFICATA') goduto += d.quota; else pianificato += d.quota; }
  }
  return { goduto, pianificato, in_attesa: inAttesa, rol_goduto: rolGoduto, rol_pianificato: rolPianificato, rol_in_attesa: rolAttesa };
}

/** Saldo completo di una persona del perimetro per un anno */
export async function saldoPersona(p, anno, s) {
  const st = s || (await settings());
  const giorno = oggi();
  const sp = await spettanzaAnnua(p, anno);
  const base = await one('SELECT residuo_ap, rol_residuo_ap_ore, note, fonte, updated_at FROM saldi WHERE person_id=$1 AND anno=$2', [p.id, anno]);
  const rich = await many(`SELECT tipo, stato, data_inizio, data_fine, mezza_inizio, mezza_fine, giorni, ore FROM richieste WHERE person_id=$1 AND anno=$2 AND stato IN ('PIANIFICATA','RICHIESTA','APPROVATA','GODUTA')`, [p.id, anno]);
  const cal = await calendarioPersona(p, [anno], st);
  const rip = ripartisci(rich, cal, giorno);
  const sp2 = calcSpettanza(anno, sp.giorni_annui, { inizio: p.inizio, fine: p.fine, oggi: giorno, soglia: Number(st.soglia_mese_giorni || 15) });
  const sal = calcSaldo({ residuo_ap: Number(base?.residuo_ap || 0), spettanza: sp2.spettanza, maturato: sp2.maturato, goduto: rip.goduto, pianificato: rip.pianificato, in_attesa: rip.in_attesa });
  const out = {
    anno, ...sal, giorni_annui: sp.giorni_annui, spettanza_fonte: sp.fonte, mesi: sp2.mesi, mesi_maturati: sp2.mesi_maturati,
    settimana: cal.settimana_etichetta, settimana_fonte: cal.settimana_fonte, note: base?.note || null, residuo_ap_fonte: base?.fonte || null, residuo_ap_aggiornato: base?.updated_at || null,
    avvisi: avvisiSaldo(sal, { anno, oggi: giorno, scadenzaAp: st.scadenza_ap || '06-30', mesiRischio: st.mesi_rischio || [10, 11], sogliaRischio: Number(st.soglia_rischio_giorni || 10) }),
  };
  if (st.rol_attivi) {
    const annue = sp.rol_ore_annue;
    const rolSp = annue != null ? Math.round(calcSpettanza(anno, annue, { inizio: p.inizio, fine: p.fine, oggi: giorno, soglia: Number(st.soglia_mese_giorni || 15) }).spettanza * 100) / 100 : null;
    const ap = Number(base?.rol_residuo_ap_ore || 0);
    out.rol = { ore_annue: annue, spettanza: rolSp, residuo_ap: ap, goduto: rip.rol_goduto, pianificato: rip.rol_pianificato, in_attesa: rip.rol_in_attesa,
      residuo: rolSp == null ? null : Math.round((ap + rolSp - rip.rol_goduto - rip.rol_pianificato) * 100) / 100 };
  }
  return out;
}

// ---------------------------------------------------------------- richieste, eventi, notifiche
export const R_COLS = `r.*, p.last_name || ' ' || p.first_name AS persona, ap.last_name || ' ' || ap.first_name AS approvatore_nome,
  du.full_name AS deciso_da_nome, iu.full_name AS inserita_da_nome, c.descrizione AS chiusura_descrizione`;
export const R_FROM = `richieste r JOIN public.people p ON p.id = r.person_id LEFT JOIN public.people ap ON ap.id = r.approvatore_person_id
  LEFT JOIN public.users du ON du.id = r.deciso_da_user_id LEFT JOIN public.users iu ON iu.id = r.inserita_da_user_id LEFT JOIN chiusure c ON c.id = r.chiusura_id`;
export async function loadRichiesta(id, runner = q) {
  const r = await runner(`SELECT ${R_COLS} FROM ${R_FROM} WHERE r.id=$1`, [id]);
  return r.rows[0] || null;
}

export async function evento(richiestaId, tipo, userId, dati = {}, client) {
  const runner = client ? client.query.bind(client) : q;
  await runner('INSERT INTO eventi (richiesta_id, tipo, user_id, dati) VALUES ($1,$2,$3,$4)', [richiestaId, tipo, userId || null, JSON.stringify(dati || {})]);
}

/** Utenti attivi della Suite collegati alle persone indicate */
export async function utentiDiPersone(personIds) {
  const ids = [...new Set((personIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return [];
  return (await many(`SELECT id FROM public.users WHERE status='ACTIVE' AND person_id = ANY($1::int[])`, [ids])).map((r) => r.id);
}
/** Utenti ADMIN del modulo (HR): grant ferie ADMIN; senza nessuno, Owner e Admin della Suite */
export async function utentiHr() {
  const g = (await many(`SELECT g.user_id AS id FROM public.grants g JOIN public.users u ON u.id=g.user_id WHERE g.module_key=$1 AND g.profile='ADMIN' AND NOT g.proposed AND u.status='ACTIVE'`, [KEY])).map((r) => r.id);
  if (g.length) return g;
  return (await many(`SELECT id FROM public.users WHERE status='ACTIVE' AND level IN ('OWNER','ADMIN')`)).map((r) => r.id);
}

/**
 * Notifica in app (notify della Suite) e, se l'impostazione email_attiva è accesa, email con il mittente della Suite agli utenti
 * con email e notify_email. Nessuna casella inventata: solo gli indirizzi degli utenti della Suite.
 */
export async function notifica(userIds, r, { evento: ev, title, body, exclude = [], link: linkDato }) {
  const ids = [...new Set((userIds || []).map(Number).filter((x) => Number.isInteger(x) && !exclude.includes(x)))];
  if (!ids.length) return 0;
  const link = linkDato || `/ferie/richieste/${r.id}`;
  await notify(ids, { kind: 'FERIE', module_key: KEY, title: String(title).slice(0, 200), body: body || null, link });
  const s = await settings();
  if (s.email_attiva) {
    const users = await many(`SELECT id, email FROM public.users WHERE id = ANY($1::int[]) AND status='ACTIVE' AND notify_email AND email IS NOT NULL`, [ids]);
    const url = `${config.baseUrl}${link}`;
    const html = layout('Piano Ferie', `<p><b>${escapeHtml(title)}</b></p>${body ? `<p>${escapeHtml(body)}</p>` : ''}<p><a href="${url}">Apri il Piano Ferie nella Suite</a></p>`);
    for (const u of users) {
      try { await sendMail({ to: u.email, subject: `Piano Ferie: ${title}`, html, ref: `ferie:${r.id}:${ev}` }); } catch (e) { console.error('[ferie:mail]', e.message); }
    }
  }
  return ids.length;
}

export const periodoTesto = (r) => {
  const a = itData(r.data_inizio), b = itData(r.data_fine);
  const m = (r.mezza_inizio ? ' (dal pomeriggio)' : '');
  const n = (r.mezza_fine ? ' (fino alla mattina)' : '');
  return a === b ? `${a}${r.mezza_inizio ? ' pomeriggio' : r.mezza_fine ? ' mattina' : ''}` : `dal ${a}${m} al ${b}${n}`;
};
export const quantitaTesto = (r) => (r.tipo === 'ROL' ? `${Number(r.ore || 0).toLocaleString('it-IT')} ore di ROL/permesso` : `${Number(r.giorni || 0).toLocaleString('it-IT')} ${Number(r.giorni) === 1 ? 'giorno' : 'giorni'} di ferie`);
