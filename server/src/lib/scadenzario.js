// Scadenzario unico di direzione (decisione del CEO, 08/11/2026: "scadenzario unico di direzione che integra il Cockpit").
// Una sola funzione di lettura, scadenzeDirezione({ da, a, aree }), che raccoglie le scadenze vere dei moduli e dell'anagrafica in righe
// normalizzate: { id, data, modulo, area, tipo, titolo, descrizione, oggetto, importo, stima, stato, giorni, gravita, link, responsabile,
// fonte }. Tecnica safe() del Cockpit (lib/legacy.js): ogni fonte di un modulo si legge solo se il modulo è LIVE nella Suite (pool del
// modulo, search_path = <modulo>, public); un modulo non LIVE o una lettura fallita non danno righe ma una fonte "non disponibile" con
// la nota, mai zero silenziosi. Nessuna data inventata: solo campi con una data registrata (o una soglia dichiarata nelle impostazioni,
// es. proposte senza risposta da oltre N giorni). Elenco delle fonti e dei campi letti: docs/COCKPIT.md.
import { many, one, q } from '../db.js';
import { moduleDb } from './modules.js';
import { getSetting } from './util.js';

// ------------------------------------------------------------------ costanti e funzioni pure (test: server/test/cockpit-scadenzario.test.mjs)
export const STATI = ['SCADUTA', 'OGGI', 'ENTRO_7', 'ENTRO_30', 'OLTRE'];
export const STATO_LABEL = { SCADUTA: 'Scaduta', OGGI: 'Oggi', ENTRO_7: 'Entro 7 giorni', ENTRO_30: 'Entro 30 giorni', OLTRE: 'Oltre 30 giorni' };
export const GRAVITA = ['BASSA', 'MEDIA', 'ALTA', 'CRITICA'];
export const AREE = { DIREZIONE: 'Direzione', FINANCE: 'Finance', RETAIL_FLOW: 'Retail e Flow', OPERATIONS: 'Operations', HQS: 'HQS', PEOPLE: 'People' };
// Moduli con dati personali o del dossier HR: le loro righe arrivano solo a chi ha il grant del modulo o a titolare e amministratori
// (come la card "Scadenze contrattuali" del Cockpit, riservata a chi ha Contratti del personale)
export const MODULI_RISERVATI = ['contracts', 'ferie', 'room', 'rimborsi'];
// Impostazioni (app_settings 'cockpit.scadenzario', Amministrazione > Impostazioni). Le soglie in giorni sono ipotesi dichiarate.
export const IMPOSTAZIONI_DEFAULT = {
  notifica_attiva: true,     // job core:scadenzario: notifica giornaliera a titolare e amministratori dopo le 8
  notifica_ora: 8,           // ora (Europe/Rome) dalla quale parte la notifica del giorno
  proposte_giorni: 30,       // Business Hub: proposte e offerte inviate senza risposta da oltre N giorni
  ordini_giorni: 2,          // Ordini: ordini inviati in attesa di approvazione da oltre N giorni
  circolari_giorni: 7,       // Circolari: presa visione non confermata oltre N giorni dalla pubblicazione
};

const DAY = 86_400_000;
// data ISO esistente (il 31/02 non passa: Date la sposterebbe al 3 marzo)
const isIso = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10))) return false;
  const t = new Date(`${s.slice(0, 10)}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s.slice(0, 10);
};
export const iso = (v) => {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
  const s = String(v);
  if (isIso(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);   // gg/mm/aaaa (certificazioni del sito)
  if (m) { const x = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; return isIso(x) ? x : null; }
  return null;
};
export const oggiRoma = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
export const giorniTra = (da, a) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${da}T12:00:00Z`)) / DAY);
export function addGiorni(d, n) { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
export function addMesi(d, n) {
  const [y, m, g] = d.split('-').map(Number);
  const tot = y * 12 + (m - 1) + n; const ny = Math.floor(tot / 12), nm = tot % 12;
  const ult = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(g, ult)).padStart(2, '0')}`;
}
export const fineMese = (d) => addGiorni(addMesi(`${d.slice(0, 7)}-01`, 1), -1);
export const itData = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '');

/**
 * Piano Ferie (piano annuale, decisione del CEO dell'08/11/2026): righe dello scadenzario dai piani raggruppati per anno e stato.
 * scadenze: { 'AAAA': 'AAAA-MM-GG' } (impostazione scadenze_piano del modulo); piani: [{ anno, stato, n, primo_invio, prima_approvazione }]
 * (date ISO). Righe: scadenza di invio con i piani ancora in BOZZA; piani inviati da approvare (primo invio + G giorni); piani approvati
 * non ancora definitivi (prima approvazione + G giorni). Solo date registrate o soglie dichiarate (G = promemoria_giorni).
 */
export function righeFeriePiani({ scadenze = {}, piani = [], G = 3, da, a }) {
  const out = [];
  const conta = (anno, stati) => piani.filter((p) => Number(p.anno) === Number(anno) && stati.includes(p.stato)).reduce((t, p) => t + Number(p.n || 0), 0);
  const dentro = (d) => d && d >= da && d <= a;
  for (const [anno, scad] of Object.entries(scadenze || {})) {
    const d = iso(scad);
    const bozze = conta(anno, ['BOZZA']);
    if (!dentro(d) || !bozze) continue;
    out.push({ chiave: `piano_invio:${anno}`, data: d, tipo: 'Scadenza invio piano ferie', titolo: `Invio del piano ferie ${anno} da parte dei dipendenti`,
      descrizione: `${bozze} ${bozze === 1 ? 'piano non ancora inviato' : 'piani non ancora inviati'} al responsabile`, oggetto: `Piano ferie ${anno}`, gravita: 'MEDIA', link: '/ferie/cruscotto', responsabile: 'Dipendenti e responsabili di area' });
  }
  const anni = [...new Set(piani.map((p) => Number(p.anno)))].sort();
  for (const anno of anni) {
    const inviati = piani.filter((p) => Number(p.anno) === anno && ['PROPOSTO', 'IN_REVISIONE'].includes(p.stato));
    const nI = inviati.reduce((t, p) => t + Number(p.n || 0), 0);
    const primo = inviati.map((p) => p.primo_invio).filter(Boolean).sort()[0];
    if (nI && primo && dentro(addGiorni(primo, G))) out.push({ chiave: `piani_da_approvare:${anno}`, data: addGiorni(primo, G), tipo: 'Piani ferie da approvare', titolo: `Piani ferie ${anno} inviati e non ancora approvati`,
      descrizione: `${nI} ${nI === 1 ? 'piano' : 'piani'} in attesa del responsabile da più di ${G} giorni (dal primo invio del ${itData(primo)})`, oggetto: `Piano ferie ${anno}`, gravita: 'ALTA', link: '/ferie/cruscotto', responsabile: 'Responsabili di area' });
    const appr = piani.filter((p) => Number(p.anno) === anno && p.stato === 'APPROVATO');
    const nA = appr.reduce((t, p) => t + Number(p.n || 0), 0);
    const prima = appr.map((p) => p.prima_approvazione).filter(Boolean).sort()[0];
    if (nA && prima && dentro(addGiorni(prima, G))) out.push({ chiave: `piani_non_definitivi:${anno}`, data: addGiorni(prima, G), tipo: 'Piani ferie non definitivi', titolo: `Piani ferie ${anno} approvati ma non ancora definitivi`,
      descrizione: `${nA} ${nA === 1 ? 'piano' : 'piani'} da rendere definitivi`, oggetto: `Piano ferie ${anno}`, gravita: 'MEDIA', link: '/ferie/cruscotto', responsabile: 'Responsabili di area' });
  }
  return out;
}

/** Stato rispetto a oggi: SCADUTA (data passata), OGGI, ENTRO_7 (1-7 giorni), ENTRO_30 (8-30), OLTRE. */
export function statoScadenza(data, oggi) {
  const g = giorniTra(oggi, data);
  return g < 0 ? 'SCADUTA' : g === 0 ? 'OGGI' : g <= 7 ? 'ENTRO_7' : g <= 30 ? 'ENTRO_30' : 'OLTRE';
}
/** Gravità effettiva: quella del tipo di scadenza, un livello più alta se è già scaduta (al massimo CRITICA). */
export function gravitaEffettiva(base, stato) {
  const i = Math.max(0, GRAVITA.indexOf(base || 'MEDIA'));
  return GRAVITA[Math.min(GRAVITA.length - 1, stato === 'SCADUTA' ? i + 1 : i)];
}
/** Settimana ISO (da lunedì a domenica) della data: chiave = lunedì, etichetta leggibile. */
export function settimana(data) {
  const t = new Date(`${data}T12:00:00Z`);
  const lun = addGiorni(data, -((t.getUTCDay() + 6) % 7));
  const dom = addGiorni(lun, 6);
  return { chiave: lun, etichetta: `Settimana dal ${itData(lun).slice(0, 5)} al ${itData(dom)}` };
}
const PESO_G = { CRITICA: 0, ALTA: 1, MEDIA: 2, BASSA: 3 };
/** Ordine della tabella: per data, a parità di data prima le più gravi, poi per titolo. */
export const ordina = (righe) => [...righe].sort((x, y) => x.data.localeCompare(y.data) || (PESO_G[x.gravita] - PESO_G[y.gravita]) || x.titolo.localeCompare(y.titolo, 'it'));

/** Riga normalizzata. `chiave` è stabile (fonte + oggetto + data): serve a "Segna come vista". */
export function riga(fonte, { chiave, data, tipo, titolo, descrizione = null, oggetto = null, importo = null, stima = false, gravita = 'MEDIA', link = null, responsabile = null }, oggi) {
  const d = iso(data);
  if (!d) return null;
  const stato = statoScadenza(d, oggi);
  return {
    id: `${fonte.key}:${chiave}`, data: d, modulo: fonte.modulo || 'core', modulo_nome: fonte.nome, area: fonte.area, fonte: fonte.key, tipo, titolo,
    descrizione: descrizione || null, oggetto: oggetto || null, importo: importo == null || importo === '' ? null : Math.round(Number(importo) * 100) / 100, stima: Boolean(stima),
    stato, giorni: giorniTra(oggi, d), gravita: gravitaEffettiva(gravita, stato), gravita_base: gravita, link, responsabile: responsabile || null,
  };
}

/** Filtri della pagina: area, modulo, ricerca libera (titolo, oggetto, tipo, descrizione, responsabile), stati. */
export function filtra(righe, { area, modulo, q: testo, stati } = {}) {
  const aree = area ? String(area).split(',').filter(Boolean) : null;
  const moduli = modulo ? String(modulo).split(',').filter(Boolean) : null;
  const st = stati ? (Array.isArray(stati) ? stati : String(stati).split(',')).filter(Boolean) : null;
  const t = String(testo || '').trim().toLowerCase();
  return righe.filter((r) => (!aree || aree.includes(r.area)) && (!moduli || moduli.includes(r.modulo)) && (!st || st.includes(r.stato))
    && (!t || [r.titolo, r.oggetto, r.tipo, r.descrizione, r.responsabile, r.modulo_nome].some((x) => x && String(x).toLowerCase().includes(t))));
}
export function riepilogo(righe) {
  const out = { totale: righe.length, SCADUTA: 0, OGGI: 0, ENTRO_7: 0, ENTRO_30: 0, OLTRE: 0 };
  for (const r of righe) out[r.stato]++;
  out.entro_7 = out.OGGI + out.ENTRO_7;   // la card "Scadenze entro 7 giorni" e il contatore della Home: da oggi a 7 giorni
  return out;
}
export function raggruppaPerSettimana(righe) {
  const m = new Map();
  for (const r of ordina(righe)) { const s = settimana(r.data); if (!m.has(s.chiave)) m.set(s.chiave, { ...s, righe: [] }); m.get(s.chiave).righe.push(r); }
  return [...m.values()];
}
/** Righe che l'utente può vedere: moduli riservati solo con il grant del modulo (o titolare e amministratori). */
export function visibiliA(righe, user) {
  const admin = user?.level === 'OWNER' || user?.level === 'ADMIN';
  return righe.filter((r) => !MODULI_RISERVATI.includes(r.modulo) || admin || Boolean(user?.grants?.[r.modulo]));
}
/** Segna "vista" le righe nascoste dall'utente fino a una data (compresa): una vista con fino_a passato non nasconde più. */
export function applicaViste(righe, viste, oggi) {
  const m = new Map((viste || []).filter((v) => iso(v.fino_a) && iso(v.fino_a) >= oggi).map((v) => [v.chiave, iso(v.fino_a)]));
  return righe.map((r) => (m.has(r.id) ? { ...r, vista_fino_a: m.get(r.id) } : r));
}
/** Data predefinita di "Segna come vista": la data della scadenza se è futura, altrimenti tra 7 giorni. */
export const vistaPredefinita = (data, oggi) => (data && data > oggi ? data : addGiorni(oggi, 7));
/** Finestra predefinita della pagina: da 30 giorni fa a 90 giorni avanti. */
export const finestraPredefinita = (oggi) => ({ da: addGiorni(oggi, -30), a: addGiorni(oggi, 90) });
/** Prossimo periodo di una locazione con rinnovo tacito: fine del primo periodo e, se è passata, i rinnovi di `rinnovo` anni. */
export function finiLocazione({ fine, rinnovoAnni, da, a, maxCicli = 40 }) {
  const out = [];
  let f = iso(fine);
  if (!f) return out;
  const R = Number(rinnovoAnni) || 0;
  for (let i = 0; i < maxCicli && f <= a; i++) {
    if (f >= da) out.push({ fine: f, rinnovi: i });
    if (!R) break;
    f = addMesi(f, R * 12);
  }
  return out;
}

// ------------------------------------------------------------------ lettura difensiva (stessa tecnica di safe() in lib/legacy.js)
async function statoModulo(key) {
  const r = await one('SELECT mode FROM public.module_state WHERE key=$1', [key]).catch(() => null);
  return r?.mode || 'OFF';
}
async function impostazioni() {
  const v = await getSetting('cockpit.scadenzario', null).catch(() => null);
  return { ...IMPOSTAZIONI_DEFAULT, ...(v && typeof v === 'object' ? v : {}) };
}
export { impostazioni as impostazioniScadenzario };
const nome = (...p) => p.map((x) => (x || '').trim()).filter(Boolean).join(' ');

// ------------------------------------------------------------------ fonti
// Ogni fonte: key, modulo (chiave del modulo, null = anagrafica del core sempre leggibile), nome, area, campi letti (per la pagina e
// docs/COCKPIT.md), leggi(ctx) → righe grezze (passate a riga()). ctx = { da, a, oggi, imp, db } (db = pool del modulo).
export const FONTI = [
  {
    key: 'sedi', modulo: null, nome: 'Sedi (Amministrazione)', area: 'DIREZIONE',
    campi: 'public.sites: tenure LOCAZIONE/COMODATO, lease_end, lease_renewal_years, lease_notice_months, locatore; responsabile dall\'organigramma',
    async leggi({ da, a }) {
      // Le sedi con un contratto attivo nello Scadenziario di Finance Management (LIVE) compaiono da lì (scadenza e disdetta del
      // contratto con i rinnovi): qui solo le altre, per non avere la stessa scadenza due volte
      const fin = (await statoModulo('finance')) === 'LIVE'
        ? new Set((await many(`SELECT DISTINCT site_id FROM finance.lease_contracts WHERE active`).catch(() => [])).map((x) => x.site_id)) : new Set();
      const rows = await many(`SELECT s.id, s.name, s.tenure, s.lease_end, s.lease_renewal_years, s.lease_notice_months, lo.name AS locatore, h.person_name AS responsabile
          FROM public.sites s LEFT JOIN public.organizations lo ON lo.id = s.lease_landlord_org_id
          LEFT JOIN LATERAL (SELECT pp.last_name || ' ' || pp.first_name AS person_name FROM public.org_units u JOIN public.org_positions op ON op.unit_id = u.id AND op.is_head
              JOIN public.people pp ON pp.id = op.person_id AND pp.status = 'ATTIVO' WHERE u.kind = 'SEDE' AND u.site_id = s.id ORDER BY op.sort_order, op.id LIMIT 1) h ON TRUE
         WHERE s.active AND s.kind <> 'SERVICE' AND s.tenure IN ('LOCAZIONE','COMODATO') AND s.lease_end IS NOT NULL ORDER BY s.name`);
      const out = [];
      for (const s of rows) {
        if (fin.has(s.id)) continue;
        const N = Number(s.lease_notice_months) || 0;
        const tit = s.tenure === 'COMODATO' ? 'comodato' : 'locazione';
        // fini dei periodi entro la finestra; per la disdetta servono anche le fini fino a N mesi dopo la finestra
        for (const p of finiLocazione({ fine: s.lease_end, rinnovoAnni: s.lease_renewal_years, da, a: N ? addMesi(a, N) : a })) {
          if (p.fine >= da && p.fine <= a) {
            out.push({ chiave: `fine:${s.id}:${p.fine}`, data: p.fine, tipo: `Scadenza ${tit}`, titolo: `Fine del periodo di ${tit}${p.rinnovi ? ` (rinnovo ${p.rinnovi})` : ''}`,
              descrizione: [s.locatore && `Locatore ${s.locatore}`, Number(s.lease_renewal_years) ? `poi rinnovo tacito di ${s.lease_renewal_years} anni` : 'nessun rinnovo indicato in anagrafica'].filter(Boolean).join(' · '),
              oggetto: s.name, gravita: 'ALTA', link: '/admin/sites', responsabile: s.responsabile });
          }
          if (N) {
            const dd = addMesi(p.fine, -N);
            if (dd >= da && dd <= a) out.push({ chiave: `disdetta:${s.id}:${dd}`, data: dd, tipo: `Disdetta ${tit}`, titolo: 'Termine per inviare la disdetta',
              descrizione: `Preavviso di ${N} mesi rispetto alla fine del periodo del ${itData(p.fine)}`, oggetto: s.name, gravita: 'ALTA', link: '/admin/sites', responsabile: s.responsabile });
          }
        }
      }
      return out;
    },
  },
  {
    key: 'finance_scadenziario', modulo: 'finance', nome: 'Finance Management · Scadenziario strutture', area: 'FINANCE',
    campi: 'finance.lease_contracts, lease_steps, utilities, utility_bills, schedule_done, schedule_requests (eventi di lib/scheduleData.js + lib/schedule.js buildEvents: canoni, ISTAT, imposta di registro, scadenza e disdetta del contratto, bollette registrate e attese, fine offerta), non fatti e non ad addebito automatico',
    async leggi({ da, a, oggi }) {
      const { loadScheduleData, siteName } = await import('../modules/finance/lib/scheduleData.js');
      const { buildEvents } = await import('../modules/finance/lib/schedule.js');
      const d = await loadScheduleData(null);
      if (!d.leases.length && !d.utilities.length) return [];
      const ev = buildEvents({ ...d, from: da, to: a, today: oggi });
      const TIPO = { canone: 'Canone di locazione', istat: 'Adeguamento ISTAT', registro: 'Imposta di registro', fine: 'Scadenza contratto di locazione', disdetta: 'Termine di disdetta', bolletta: 'Utenza', offerta: 'Fine offerta utenza' };
      const GRAV = { fine: 'ALTA', disdetta: 'ALTA', canone: 'MEDIA', registro: 'MEDIA', bolletta: 'MEDIA', istat: 'BASSA', offerta: 'BASSA' };
      return ev.filter((e) => !e.done && !e.auto && (e.date >= da || e.kind === 'fine') && e.date <= a).map((e) => ({
        chiave: e.key, data: e.date, tipo: TIPO[e.kind] || e.kind, titolo: e.title, oggetto: siteName(d.sites, e.site_id), importo: e.amount, stima: e.estimate, gravita: GRAV[e.kind] || 'MEDIA',
        descrizione: [e.desc, e.request ? `Istanza ${e.request.protocol || `#${e.request.id}`} · ${String(e.request.status || '').toLowerCase()}` : null].filter(Boolean).join(' · '),
        link: `/finance/scadenziario?site_id=${e.site_id}`,
      }));
    },
  },
  {
    key: 'finance_istanze', modulo: 'finance', nome: 'Finance Management · Istanze di pagamento', area: 'FINANCE',
    campi: 'finance.payment_requests: stato IN_FIRMA (in firma) e FIRMATA (autorizzata, da eseguire) con value_date (data valuta), importo, beneficiario, sede (site_id), scaglione e firmatario',
    async leggi({ da, a, db }) {
      const haSede = Boolean(await one(`SELECT 1 FROM information_schema.columns WHERE table_schema='finance' AND table_name='payment_requests' AND column_name='site_id'`));
      const rows = await db.many(`SELECT p.id, p.protocol, p.status, p.amount, p.value_date, p.beneficiary_name, p.purpose, p.requester, p.tier, p.single_signer${haSede ? ', s.name AS sede' : ', NULL AS sede'}
          FROM payment_requests p ${haSede ? 'LEFT JOIN public.sites s ON s.id = p.site_id' : ''}
         WHERE p.status IN ('IN_FIRMA','FIRMATA') AND p.value_date BETWEEN $1 AND $2`, [da, a]);
      const firma = (p) => (p.tier === 'SINGOLA' ? p.single_signer : p.tier === 'CONGIUNTA' ? 'CEO e CFO' : p.tier === 'CDA' ? 'CEO e CFO (delibera CdA)' : null);
      return rows.map((p) => ({
        chiave: `${p.status}:${p.id}:${p.value_date}`, data: p.value_date, tipo: p.status === 'IN_FIRMA' ? 'Istanza in firma' : 'Pagamento autorizzato da eseguire',
        titolo: `${p.status === 'IN_FIRMA' ? 'Firma dell\'istanza' : 'Esecuzione dell\'istanza'} ${p.protocol || `#${p.id}`} (data valuta)`,
        descrizione: [p.purpose, p.requester && `richiesta da ${p.requester}`].filter(Boolean).join(' · '), oggetto: [p.beneficiary_name, p.sede].filter(Boolean).join(' · '),
        importo: p.amount, gravita: p.status === 'IN_FIRMA' ? 'ALTA' : 'MEDIA', link: `/finance/istanze/${p.id}`, responsabile: p.status === 'IN_FIRMA' ? firma(p) : null,
      }));
    },
  },
  {
    key: 'business_contratti', modulo: 'business', nome: 'Business Hub · Contratti', area: 'RETAIL_FLOW',
    campi: 'business.contracts: end_date dei contratti FIRMATO/AUTORIZZATO/ATTIVO, preavviso data.rent.notice_months o data.notice_months, proposal_date dei contratti in PROPOSTA (+ soglia proposte_giorni)',
    async leggi({ da, a, imp, db }) {
      const rows = await db.many(`SELECT c.id, c.kind, c.protocol, c.status, c.title, c.proposal_date, c.end_date, c.data, o.name AS org, s.name AS sede
          FROM contracts c LEFT JOIN public.organizations o ON o.id = c.org_id LEFT JOIN public.sites s ON s.id = c.site_id
         WHERE c.status IN ('PROPOSTA','FIRMATO','AUTORIZZATO','ATTIVO')`);
      const N = Number(imp.proposte_giorni) || 30;
      const out = [];
      for (const c of rows) {
        const ogg = [c.org, c.sede].filter(Boolean).join(' · ') || c.title;
        const rif = `${c.kind} ${c.protocol || `#${c.id}`}`;
        if (c.status === 'PROPOSTA') {
          const d = c.proposal_date ? addGiorni(iso(c.proposal_date), N) : null;
          if (d && d >= da && d <= a) out.push({ chiave: `proposta:${c.id}:${d}`, data: d, tipo: 'Proposta senza risposta', titolo: `Contratto ${rif} proposto il ${itData(iso(c.proposal_date))}: nessuna firma dopo ${N} giorni`, oggetto: ogg, gravita: 'MEDIA', link: `/business/contratti/${c.id}` });
          continue;
        }
        const fine = iso(c.end_date);
        if (fine && fine >= da && fine <= a) out.push({ chiave: `fine:${c.id}:${fine}`, data: fine, tipo: 'Scadenza contratto', titolo: `Scadenza del contratto ${rif}`, descrizione: c.title, oggetto: ogg, gravita: 'ALTA', link: `/business/contratti/${c.id}` });
        const N2 = Number(c.data?.rent?.notice_months ?? c.data?.notice_months) || 0;
        if (fine && N2) {
          const dd = addMesi(fine, -N2);
          if (dd >= da && dd <= a) out.push({ chiave: `disdetta:${c.id}:${dd}`, data: dd, tipo: 'Disdetta contratto', titolo: `Termine di disdetta del contratto ${rif}`, descrizione: `Preavviso di ${N2} mesi sulla scadenza del ${itData(fine)}`, oggetto: ogg, gravita: 'ALTA', link: `/business/contratti/${c.id}` });
        }
      }
      return out;
    },
  },
  {
    key: 'business_account', modulo: 'business', nome: 'Business Hub · Account e listini', area: 'RETAIL_FLOW',
    campi: 'business.accounts: fase 4 "Offerta inviata" (phase_dates.4 + soglia proposte_giorni, senza EMAIL_IN successive), data_prossima_azione dei prospect, data_avvio_prevista dei clienti contrattualizzati non ancora attivi, owner; business.listini: revisioni inviate (revisione_inviata_at) non firmate',
    async leggi({ da, a, imp, db }) {
      const N = Number(imp.proposte_giorni) || 30;
      const rows = await db.many(`SELECT a.id, a.linea, a.fase_corrente, a.phase_dates, a.prospect, a.cliente_attivo, a.contrattualizzato_at, a.data_avvio_prevista, a.data_avvio_effettiva,
          a.prossima_azione, a.data_prossima_azione, a.non_contattare, o.name AS org, u.full_name AS owner,
          (SELECT max(x.at) FROM activities x WHERE x.account_id = a.id AND x.tipo = 'EMAIL_IN') AS ultima_email_in
        FROM accounts a JOIN public.organizations o ON o.id = a.organization_id LEFT JOIN public.users u ON u.id = a.owner_user_id`);
      const out = [];
      for (const x of rows) {
        const link = `/business/account/${x.id}`;
        const off = iso(x.phase_dates?.['4']);
        if (x.fase_corrente === 4 && off) {
          const d = addGiorni(off, N);
          const risposta = x.ultima_email_in && iso(x.ultima_email_in) >= off;
          if (!risposta && d >= da && d <= a) out.push({ chiave: `offerta:${x.id}:${off}`, data: d, tipo: 'Proposta senza risposta', titolo: `Offerta ${x.linea} inviata il ${itData(off)}: nessuna risposta dopo ${N} giorni`, oggetto: x.org, gravita: 'MEDIA', link, responsabile: x.owner });
        }
        const pa = iso(x.data_prossima_azione);
        if (pa && !x.cliente_attivo && !x.non_contattare && pa >= da && pa <= a) {
          out.push({ chiave: `richiamo:${x.id}:${pa}`, data: pa, tipo: 'Richiamo prospect', titolo: `Richiamo previsto${x.prossima_azione ? `: ${x.prossima_azione}` : ''}`, descrizione: `Linea ${x.linea}, fase ${x.fase_corrente}`, oggetto: x.org, gravita: 'BASSA', link, responsabile: x.owner });
        }
        const av = iso(x.data_avvio_prevista);
        if (av && !x.cliente_attivo && !x.data_avvio_effettiva && (x.contrattualizzato_at || x.fase_corrente >= 6) && av >= da && av <= a) {
          out.push({ chiave: `avvio:${x.id}:${av}`, data: av, tipo: 'Avvio cliente', titolo: `Avvio previsto del cliente ${x.linea}`, descrizione: 'Contratto firmato, cliente non ancora confermato attivo', oggetto: x.org, gravita: 'MEDIA', link, responsabile: x.owner });
        }
      }
      const lis = await db.many(`SELECT l.id, l.account_id, l.versione, l.revisione_inviata_at, o.name AS org, u.full_name AS owner FROM listini l JOIN accounts a ON a.id = l.account_id
          JOIN public.organizations o ON o.id = a.organization_id LEFT JOIN public.users u ON u.id = a.owner_user_id
         WHERE l.origine = 'REVISIONE' AND l.revisione_inviata_at IS NOT NULL AND l.firmata_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM listini l2 WHERE l2.account_id = l.account_id AND l2.versione > l.versione)`);
      for (const l of lis) {
        const inv = iso(l.revisione_inviata_at);
        const d = addGiorni(inv, N);
        if (d >= da && d <= a) out.push({ chiave: `listino:${l.id}:${inv}`, data: d, tipo: 'Revisione listino da firmare', titolo: `Revisione del listino v${l.versione} inviata il ${itData(inv)}: firma attesa da ${N} giorni`, oggetto: l.org, gravita: 'MEDIA', link: `/business/account/${l.account_id}`, responsabile: l.owner });
      }
      return out;
    },
  },
  {
    key: 'business_fascicoli', modulo: 'business', nome: 'Business Hub · Fascicoli di autorizzazione', area: 'RETAIL_FLOW',
    campi: 'business.dossiers non AUTORIZZATO (status, submitted_at) collegati a un contratto vigente con start_date (avvio previsto del punto)',
    async leggi({ da, a, db }) {
      const rows = await db.many(`SELECT d.id, d.status, d.submitted_at, c.id AS contract_id, c.kind, c.protocol, c.start_date, coalesce(s.name, cs.name) AS sede, o.name AS org
          FROM dossiers d JOIN contracts c ON c.id = d.contract_id LEFT JOIN public.sites s ON s.id = d.site_id LEFT JOIN public.sites cs ON cs.id = c.site_id
          LEFT JOIN public.organizations o ON o.id = coalesce(d.org_id, c.org_id)
         WHERE d.status <> 'AUTORIZZATO' AND c.start_date IS NOT NULL AND c.status NOT IN ('CESSATO','ANNULLATO') AND c.start_date BETWEEN $1 AND $2`, [da, a]);
      return rows.map((d) => ({
        chiave: `avvio:${d.id}:${iso(d.start_date)}`, data: d.start_date, tipo: 'Autorizzazione sanitaria',
        titolo: d.status === 'PRESENTATO' ? `Avvio previsto: autorizzazione presentata il ${itData(iso(d.submitted_at))}, non ancora rilasciata` : 'Avvio previsto: fascicolo di autorizzazione non ancora presentato',
        descrizione: `Contratto ${d.kind} ${d.protocol || `#${d.contract_id}`}`, oggetto: [d.sede, d.org].filter(Boolean).join(' · '), gravita: 'ALTA', link: `/business/fascicoli/${d.id}`,
      }));
    },
  },
  {
    key: 'contracts', modulo: 'contracts', nome: 'Contratti del personale', area: 'PEOPLE',
    campi: 'computeDeadlines (lib/deadlines.js): attachments.expires_at, employments.end_date/probation_end/ral_steps/MBO, lp_contracts.end_date/insurance_expiry, commitment_letters.valid_until/start_by, deadlines manuali, cessazioni; richiami people@ da deadline_reminders (60/30/7/0); presa di servizio = employments/lp_contracts.start_date delle persone in IMPEGNO',
    async leggi({ da, a, oggi, db }) {
      const { computeDeadlines } = await import('../modules/contracts/lib/deadlines.js');
      const items = await computeDeadlines({ horizonDays: Math.max(0, giorniTra(oggi, a)), today: oggi });
      const rich = new Map((await db.many(`SELECT DISTINCT ON (deadline_key) deadline_key, days_before, sent_at, status FROM deadline_reminders ORDER BY deadline_key, sent_at DESC`).catch(() => [])).map((x) => [x.deadline_key, x]));
      const TIPO = { DOCUMENTO: 'Documento del dossier', CONTRATTO: 'Contratto di lavoro', PROVA: 'Periodo di prova', RAL: 'Scatto RAL', MBO: 'MBO', IMPEGNO: 'Lettera di impegno', MANUALE: 'Scadenza HR' };
      const GRAV = { CONTRATTO: 'ALTA', PROVA: 'ALTA', DOCUMENTO: 'MEDIA', IMPEGNO: 'MEDIA', MANUALE: 'MEDIA', RAL: 'BASSA', MBO: 'BASSA' };
      const out = items.filter((i) => iso(i.due_date) >= da && iso(i.due_date) <= a).map((i) => {
        const r = rich.get(i.key);
        const nota = r ? `richiamo people@ ${r.days_before ? `dei ${r.days_before} giorni` : 'del giorno di scadenza'} ${r.status === 'INVIATO' ? 'inviato' : String(r.status || '').toLowerCase()} il ${itData(iso(r.sent_at))}` : null;
        return { chiave: i.key, data: i.due_date, tipo: TIPO[i.type] || i.type, titolo: i.title, descrizione: [i.detail, nota].filter(Boolean).join(' · '), oggetto: i.resource_name,
          gravita: GRAV[i.type] || 'MEDIA', link: i.resource_id ? `/contracts/risorse/${i.resource_id}` : '/contracts/scadenze', responsabile: i.type === 'DOCUMENTO' ? 'La persona, con HR' : 'HR' };
      });
      const ps = await db.many(`SELECT r.id, r.last_name, r.first_name, e.start_date, 'Dipendente' AS rapporto, s.name AS sede FROM employments e JOIN resources_v r ON r.id = e.resource_id LEFT JOIN public.sites s ON s.id = e.work_site_id
          WHERE r.status = 'IMPEGNO' AND e.start_date BETWEEN $1 AND $2
        UNION ALL SELECT r.id, r.last_name, r.first_name, l.start_date, 'Libero professionista', NULL FROM lp_contracts l JOIN resources_v r ON r.id = l.resource_id
          WHERE r.status = 'IMPEGNO' AND l.start_date BETWEEN $1 AND $2`, [da, a]);
      for (const p of ps) out.push({ chiave: `presa:${p.id}:${iso(p.start_date)}`, data: p.start_date, tipo: 'Presa di servizio', titolo: 'Presa di servizio prevista', descrizione: [p.rapporto, p.sede].filter(Boolean).join(' · '), oggetto: nome(p.last_name, p.first_name), gravita: 'MEDIA', link: `/contracts/risorse/${p.id}`, responsabile: 'HR' });
      return out;
    },
  },
  {
    key: 'ferie', modulo: 'ferie', nome: 'Piano Ferie', area: 'PEOPLE',
    campi: 'ferie.impostazioni scadenze_piano (data di invio del piano per anno) con ferie.piani in BOZZA; ferie.piani PROPOSTO/IN_REVISIONE (inviato_at + promemoria_giorni) e APPROVATO non definitivi (approvato_at + promemoria_giorni); ferie.richieste in stato RICHIESTA (variazioni: created_at + promemoria_giorni, approvatore), ferie.chiusure (data_inizio), ferie.saldi.residuo_ap meno i periodi FERIE approvati o goduti dell\'anno, entro l\'impostazione scadenza_ap',
    async leggi({ da, a, oggi, db }) {
      const { DEFAULTS } = await import('../modules/ferie/lib/core.js');
      const st = { ...DEFAULTS, ...Object.fromEntries((await db.many('SELECT key, value FROM impostazioni')).map((x) => [x.key, x.value])) };
      const G = Number(st.promemoria_giorni) || 3;
      const piani = await db.many(`SELECT pi.anno, pi.stato, count(*)::int AS n, min((pi.inviato_at AT TIME ZONE 'Europe/Rome')::date) AS primo_invio,
          min((pi.approvato_at AT TIME ZONE 'Europe/Rome')::date) AS prima_approvazione
        FROM piani pi JOIN public.people p ON p.id = pi.person_id AND p.status = 'ATTIVO' GROUP BY pi.anno, pi.stato`);
      const out = righeFeriePiani({ scadenze: st.scadenze_piano || {}, piani: piani.map((x) => ({ ...x, primo_invio: iso(x.primo_invio), prima_approvazione: iso(x.prima_approvazione) })), G, da, a });
      const ric = await db.many(`SELECT r.id, r.tipo, r.data_inizio, r.data_fine, r.giorni, r.ore, (r.created_at AT TIME ZONE 'Europe/Rome')::date AS creata,
          p.last_name || ' ' || p.first_name AS persona, ap.last_name || ' ' || ap.first_name AS approvatore
        FROM richieste r JOIN public.people p ON p.id = r.person_id LEFT JOIN public.people ap ON ap.id = r.approvatore_person_id WHERE r.stato = 'RICHIESTA'`);
      for (const r of ric) {
        const d = addGiorni(iso(r.creata), G);
        if (d < da || d > a) continue;
        const ini = iso(r.data_inizio);
        out.push({ chiave: `richiesta:${r.id}`, data: d, tipo: 'Variazione da decidere', titolo: `Variazione al piano ferie (${r.tipo === 'ROL' ? 'permesso' : 'ferie'}) in attesa da più di ${G} giorni`,
          descrizione: `Dal ${itData(ini)} al ${itData(iso(r.data_fine))}${r.tipo === 'ROL' ? (r.ore ? ` · ${r.ore} ore` : '') : ` · ${Number(r.giorni)} giorni`} · proposta il ${itData(iso(r.creata))}`,
          oggetto: r.persona, gravita: ini <= addGiorni(oggi, 7) ? 'ALTA' : 'MEDIA', link: `/ferie/richieste/${r.id}`, responsabile: r.approvatore || 'Amministratore' });
      }
      const ch = await db.many(`SELECT c.id, c.gruppo, c.data_inizio, c.data_fine, c.descrizione, s.name AS sede FROM chiusure c
          LEFT JOIN public.sites s ON s.id = CASE WHEN c.gruppo ~ '^SEDE:[0-9]+$' THEN substring(c.gruppo from 6)::int END WHERE c.data_inizio BETWEEN $1 AND $2`, [da, a]);
      const GR = { TUTTE: 'Tutte le aree', DIR: 'Direzione', LAB: 'Laboratorio' };
      for (const c of ch) out.push({ chiave: `chiusura:${c.id}:${iso(c.data_inizio)}`, data: c.data_inizio, tipo: 'Chiusura collettiva', titolo: `Chiusura collettiva fino al ${itData(iso(c.data_fine))}`, descrizione: c.descrizione, oggetto: GR[c.gruppo] || c.sede || c.gruppo, gravita: 'BASSA', link: '/ferie/area', responsabile: 'HR' });
      // Residuo dell'anno precedente: prima della scadenza conta da pianificare (periodi approvati e goduti dell'anno), dopo conta non
      // goduto (periodi conclusi entro oggi). Stima per periodi interi: il saldo esatto per giorno è nel Cruscotto del modulo.
      const anno = Number(oggi.slice(0, 4));
      const scad = iso(`${anno}-${st.scadenza_ap || '06-30'}`);
      if (scad && scad >= da && scad <= a) {
        const prima = oggi <= scad;
        const x = await db.one(`SELECT count(*)::int AS persone, coalesce(sum(resto), 0) AS giorni FROM (
            SELECT s.person_id, s.residuo_ap - coalesce((SELECT sum(r.giorni) FROM richieste r WHERE r.person_id = s.person_id AND r.anno = s.anno AND r.tipo = 'FERIE'
                AND r.stato IN ('APPROVATA','GODUTA') AND ($3::boolean OR r.data_fine <= $2::date)), 0) AS resto
              FROM saldi s JOIN public.people p ON p.id = s.person_id AND p.status = 'ATTIVO' WHERE s.anno = $1 AND s.residuo_ap > 0) t WHERE resto > 0`, [anno, oggi, prima]);
        if (x?.persone) out.push({ chiave: `residuo_ap:${anno}`, data: scad, tipo: 'Residuo ferie anno precedente', titolo: prima ? 'Residuo ferie dell\'anno precedente da pianificare' : 'Residuo ferie dell\'anno precedente non goduto',
          descrizione: `${Number(x.giorni).toLocaleString('it-IT', { maximumFractionDigits: 1 })} giorni (stima per periodi interi; dettaglio nel Cruscotto ferie)`, oggetto: `${x.persone} ${x.persone === 1 ? 'dipendente' : 'dipendenti'}`, gravita: 'MEDIA', link: '/ferie/cruscotto', responsabile: 'HR' });
      }
      return out;
    },
  },
  {
    // v0.72.0 · Rimborso Spese (docs/RIMBORSI.md): note in attesa del responsabile oltre la soglia del promemoria e note approvate non
    // ancora liquidate da oltre 10 giorni (soglia dichiarata, non di policy). Solo date registrate: inviata_at, approvata_at.
    key: 'rimborsi', modulo: 'rimborsi', nome: 'Rimborso Spese', area: 'PEOPLE',
    campi: 'rimborsi.note INVIATA (inviata_at + impostazione promemoria_responsabile_giorni, predefinito 5; responsabile_person_id o P&C per il vertice) e APPROVATA o IN_LIQUIDAZIONE (approvata_at + 10 giorni), con totale rimborsabile e saldo',
    async leggi({ da, a, oggi, db }) {
      const imp = Object.fromEntries((await db.many('SELECT key, value FROM impostazioni')).map((x) => [x.key, x.value]));
      const G = Number(imp.promemoria_responsabile_giorni) || 5;
      const LIQ = 10;
      const rows = await db.many(`SELECT n.id, n.anno, n.mese, n.stato, n.al_pc, n.tot_rimborsabile, n.saldo, (n.inviata_at AT TIME ZONE 'Europe/Rome')::date AS inviata, (n.approvata_at AT TIME ZONE 'Europe/Rome')::date AS approvata,
          p.last_name || ' ' || p.first_name AS persona, r.last_name || ' ' || r.first_name AS responsabile
        FROM note n JOIN public.people p ON p.id = n.person_id LEFT JOIN public.people r ON r.id = n.responsabile_person_id WHERE n.stato IN ('INVIATA','APPROVATA','IN_LIQUIDAZIONE')`);
      const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
      const euro = (v) => `${Number(v || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
      const out = [];
      for (const n of rows) {
        const mese = `${MESI[n.mese - 1]} ${n.anno}`;
        if (n.stato === 'INVIATA' && n.inviata) {
          const d = addGiorni(iso(n.inviata), G);
          if (d >= da && d <= a) out.push({ chiave: `approva:${n.id}`, data: d, tipo: 'Nota spese da approvare', titolo: `Nota spese di ${mese} in attesa di approvazione da più di ${G} giorni`, descrizione: `Inviata il ${itData(iso(n.inviata))} · totale rimborsabile ${euro(n.tot_rimborsabile)}`, oggetto: n.persona, gravita: d < oggi ? 'ALTA' : 'MEDIA', link: `/rimborsi/nota/${n.id}`, responsabile: n.al_pc ? 'P&C (vertice dell\'organigramma)' : n.responsabile || 'Responsabile' });
        } else if (n.approvata) {
          const d = addGiorni(iso(n.approvata), LIQ);
          if (d >= da && d <= a) out.push({ chiave: `liquida:${n.id}`, data: d, tipo: 'Nota spese da liquidare', titolo: `Nota spese di ${mese} approvata e non ancora liquidata`, descrizione: `Approvata il ${itData(iso(n.approvata))} · saldo ${euro(n.saldo)}`, oggetto: n.persona, gravita: 'MEDIA', link: `/rimborsi/nota/${n.id}`, responsabile: 'P&C' });
        }
      }
      return out;
    },
  },
  {
    key: 'facility', modulo: 'facility', nome: 'Facility e Manutenzioni', area: 'OPERATIONS',
    campi: 'facility.maintenance_plans PIANIFICATA/SCADUTA (due_date, kind VERIFICA_NORMATIVA, performer), work_orders aperti (due_at = SLA della priorità, assegnatario), property_documents.valid_until (certificazioni, ultima per titolo), properties.ape_valid_until',
    async leggi({ da, a, oggi, db }) {
      const out = [];
      const piano = await db.many(`SELECT m.id, m.title, m.kind, m.stream, m.performer, m.due_date, s.name AS sede FROM maintenance_plans m JOIN public.sites s ON s.id = m.site_id
         WHERE m.status IN ('PIANIFICATA','SCADUTA') AND m.due_date BETWEEN $1 AND $2`, [da, a]);
      const PERF = { SEDE: 'La sede', MANUTENTORE: 'Manutentore', ENTE: 'Ente di verifica' };
      for (const m of piano) {
        const norm = m.kind === 'VERIFICA_NORMATIVA' || m.kind === 'COLLAUDO';
        out.push({ chiave: `piano:${m.id}`, data: m.due_date, tipo: norm ? 'Scadenza normativa' : 'Manutenzione programmata', titolo: m.title, oggetto: m.sede,
          gravita: norm ? 'ALTA' : m.stream === 'SORVEGLIANZA' ? 'BASSA' : 'MEDIA', link: '/facility/piano', responsabile: PERF[m.performer] || m.performer });
      }
      const wo = await db.many(`SELECT w.id, w.code, w.title, w.priority, (w.due_at AT TIME ZONE 'Europe/Rome')::date AS scad, s.name AS sede, s.id AS site_id, coalesce(u.full_name, vo.name) AS resp
          FROM work_orders w JOIN public.sites s ON s.id = w.site_id LEFT JOIN public.users u ON u.id = w.assigned_user_id LEFT JOIN public.organizations vo ON vo.id = w.vendor_org_id
         WHERE w.status <> 'CHIUSO' AND w.due_at IS NOT NULL AND (w.due_at AT TIME ZONE 'Europe/Rome')::date BETWEEN $1 AND $2`, [da, a]);
      const PG = { URGENTE: 'CRITICA', ALTA: 'ALTA', MEDIA: 'MEDIA', BASSA: 'BASSA' };
      for (const w of wo) {
        const d = iso(w.scad);
        out.push({ chiave: `intervento:${w.id}`, data: d, tipo: 'Intervento oltre SLA', titolo: `${d < oggi ? 'Intervento aperto oltre lo SLA' : 'SLA dell\'intervento'} ${w.code}: ${w.title}`,
          descrizione: `Priorità ${String(w.priority).toLowerCase()}`, oggetto: w.sede, gravita: PG[w.priority] || 'MEDIA', link: `/facility/interventi/${w.id}`, responsabile: w.resp });
      }
      const docs = await db.many(`SELECT d.id, d.kind, d.title, d.filename, d.valid_until, p.site_id, s.name AS sede FROM property_documents d JOIN properties p ON p.id = d.property_id JOIN public.sites s ON s.id = p.site_id
         WHERE d.valid_until BETWEEN $1 AND $2 AND NOT EXISTS (SELECT 1 FROM property_documents d2 WHERE d2.property_id = d.property_id AND d2.kind = d.kind
           AND coalesce(d2.title, '') = coalesce(d.title, '') AND d2.valid_until > d.valid_until)`, [da, a]);
      for (const d of docs) out.push({ chiave: `documento:${d.id}`, data: d.valid_until, tipo: d.kind === 'CERTIFICAZIONE' ? 'Certificazione dell\'immobile' : 'Documento dell\'immobile', titolo: `Scadenza ${d.title || d.filename}`, oggetto: d.sede, gravita: 'ALTA', link: `/facility/immobili/${d.site_id}` });
      const ape = await db.many(`SELECT p.site_id, p.ape_valid_until, s.name AS sede FROM properties p JOIN public.sites s ON s.id = p.site_id WHERE s.active AND p.ape_valid_until BETWEEN $1 AND $2`, [da, a]);
      for (const p of ape) out.push({ chiave: `ape:${p.site_id}:${iso(p.ape_valid_until)}`, data: p.ape_valid_until, tipo: 'Certificazione dell\'immobile', titolo: 'Scadenza dell\'attestato di prestazione energetica (APE)', oggetto: p.sede, gravita: 'MEDIA', link: `/facility/immobili/${p.site_id}` });
      return out;
    },
  },
  {
    key: 'audit', modulo: 'audit', nome: 'Audit SGI', area: 'HQS',
    campi: 'audit.audits AUTO del mese (period) non inviati, dal giorno alert_day (impostazione del modulo, 17) a fine mese, sedi in esercizio di tipo struttura (sites_v, responsabile di sede); audits.ncs[].entro (azioni sulle NC degli audit non chiusi)',
    async leggi({ da, a, oggi, db }) {
      const { STRUCTURE_KINDS, SETTINGS_DEFAULT } = await import('../modules/audit/config.js');
      const imp = { ...SETTINGS_DEFAULT, ...Object.fromEntries((await db.many('SELECT key, value FROM app_settings')).map((x) => [x.key, x.value])) };
      const giornoAlert = Number(imp.alert_day) || 17;
      const out = [];
      // mese corrente (dal giorno dell'alert) e mese precedente (scaduto se ancora mancante), se la fine del mese è nella finestra
      const mesi = [{ periodo: `${addMesi(`${oggi.slice(0, 7)}-01`, -1)}`, corrente: false }, { periodo: `${oggi.slice(0, 7)}-01`, corrente: true }];
      for (const m of mesi) {
        const fine = fineMese(m.periodo);
        if (fine < da || fine > a) continue;
        if (m.corrente && Number(oggi.slice(8, 10)) < giornoAlert) continue;
        // sedi attive di tipo struttura già aperte (opened_at) ed esistenti in anagrafica (created_at) entro la fine del mese
        const sedi = await db.many(`SELECT s.id, s.name, s.manager_name, x.id AS audit_id FROM sites_v s JOIN public.sites ps ON ps.id = s.id
            LEFT JOIN audits x ON x.kind = 'AUTO' AND x.site_id = s.id AND x.period = $1 AND x.deleted_at IS NULL
           WHERE s.active AND (s.opened_at IS NULL OR s.opened_at <= $3::date) AND (ps.created_at AT TIME ZONE 'Europe/Rome')::date <= $3::date
             AND s.kind = ANY($2) AND (x.id IS NULL OR x.status = 'BOZZA')`, [m.periodo, STRUCTURE_KINDS, fine]);
        const mese = new Date(`${m.periodo}T12:00:00Z`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        for (const s of sedi) out.push({ chiave: `auto:${s.id}:${m.periodo}`, data: fine, tipo: 'Auto-audit mensile', titolo: `Auto-audit SGI di ${mese} non ${s.audit_id ? 'inviato (in bozza)' : 'compilato'}`,
          descrizione: `Avviso alle sedi dal giorno ${giornoAlert} del mese`, oggetto: s.name, gravita: 'MEDIA', link: s.audit_id ? `/audit/miei/${s.audit_id}` : `/audit/sedi/${s.id}`, responsabile: s.manager_name });
      }
      const ncs = await db.many(`SELECT x.id, x.kind, s.name AS sede, o.name AS org, t.n->>'descrizione' AS descrizione, t.n->>'entro' AS entro, t.n->>'persona_riferimento' AS resp, t.ord
          FROM audits x CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(x.ncs) = 'array' THEN x.ncs ELSE '[]'::jsonb END) WITH ORDINALITY AS t(n, ord)
          LEFT JOIN public.sites s ON s.id = x.site_id LEFT JOIN public.organizations o ON o.id = x.organization_id
         WHERE x.deleted_at IS NULL AND x.status <> 'CHIUSO' AND (t.n->>'entro') ~ '^\\d{4}-\\d{2}-\\d{2}$' AND (t.n->>'entro')::date BETWEEN $1 AND $2`, [da, a]);
      const KIND = { AUTO: 'auto-audit', INTERNO: 'audit interno', TERZI: 'audit di terze parti', LEGAL_ENTITY: 'audit partner' };
      for (const n of ncs) out.push({ chiave: `nc:${n.id}:${n.ord}`, data: n.entro, tipo: 'Azione su NC di audit', titolo: `Azione correttiva dell'${KIND[n.kind] || 'audit'}${n.descrizione ? `: ${String(n.descrizione).slice(0, 120)}` : ''}`, oggetto: n.sede || n.org, gravita: 'MEDIA', link: `/audit/audit/${n.id}`, responsabile: n.resp });
      return out;
    },
  },
  {
    key: 'certificazioni', modulo: 'service', nome: 'Certificazioni SGI (specchio del sito)', area: 'HQS',
    campi: 'service.contenuti chiave certificazioni (certificazioni.json del sito pubblico): norma, numero, scadenza gg/mm/aaaa dei certificati emessi',
    async leggi({ da, a, db }) {
      const r = await db.one(`SELECT json FROM contenuti WHERE chiave = 'certificazioni'`);
      const list = Array.isArray(r?.json?.certificazioni) ? r.json.certificazioni : [];
      return list.filter((c) => c.numero && iso(c.scadenza) && iso(c.scadenza) >= da && iso(c.scadenza) <= a).map((c) => ({
        chiave: `${c.numero}:${iso(c.scadenza)}`, data: iso(c.scadenza), tipo: 'Certificazione SGI', titolo: `Scadenza del certificato ${c.norma}`, descrizione: `Certificato n. ${c.numero}${c.prima_emissione ? `, emesso il ${c.prima_emissione}` : ''}`,
        oggetto: 'Sistema di Gestione Integrato', gravita: 'ALTA', link: '/service/certificazioni',
      }));
    },
  },
  {
    key: 'nc', modulo: 'nc', nome: 'Non conformità', area: 'HQS',
    campi: 'nc.nc in stato INVIATA_SEDE con sla_due_at (termine di risposta della sede), gravità; nc.nc_azioni PIANIFICATA/IN_CORSO con scadenza e responsabile',
    async leggi({ da, a, oggi, db }) {
      const GN = { CRITICA: 'CRITICA', MAGGIORE: 'ALTA', MINORE: 'MEDIA' };
      const out = [];
      const nc = await db.many(`SELECT n.id, n.codice, n.gravita, (n.sla_due_at AT TIME ZONE 'Europe/Rome')::date AS scad, coalesce(s.name, o.name) AS sede FROM nc n
          LEFT JOIN public.sites s ON s.id = n.site_id LEFT JOIN public.organizations o ON o.id = n.org_id
         WHERE n.stato = 'INVIATA_SEDE' AND n.sla_due_at IS NOT NULL AND (n.sla_due_at AT TIME ZONE 'Europe/Rome')::date BETWEEN $1 AND $2`, [da, a]);
      for (const n of nc) { const d = iso(n.scad); out.push({ chiave: `sla:${n.id}`, data: d, tipo: 'NC oltre il termine', titolo: `${d < oggi ? 'NC aperta oltre il termine di risposta' : 'Termine di risposta della sede'}: ${n.codice}`, descrizione: `Gravità ${String(n.gravita).toLowerCase()}`, oggetto: n.sede, gravita: GN[n.gravita] || 'MEDIA', link: `/nc/nc/${n.id}`, responsabile: 'La sede inviante' }); }
      const az = await db.many(`SELECT x.id, x.nc_id, x.tipo, x.descrizione, x.responsabile, x.scadenza, n.codice, n.gravita, coalesce(s.name, o.name) AS sede FROM nc_azioni x JOIN nc n ON n.id = x.nc_id
          LEFT JOIN public.sites s ON s.id = n.site_id LEFT JOIN public.organizations o ON o.id = n.org_id
         WHERE x.stato IN ('PIANIFICATA','IN_CORSO') AND n.stato <> 'ANNULLATA' AND x.scadenza BETWEEN $1 AND $2`, [da, a]);
      for (const x of az) out.push({ chiave: `azione:${x.id}`, data: x.scadenza, tipo: 'Azione su NC', titolo: `Azione ${x.tipo === 'PREVENTIVA' ? 'preventiva' : 'correttiva'} della ${x.codice}: ${String(x.descrizione).slice(0, 120)}`, oggetto: x.sede, gravita: GN[x.gravita] || 'MEDIA', link: `/nc/nc/${x.nc_id}`, responsabile: x.responsabile });
      return out;
    },
  },
  {
    key: 'orders', modulo: 'orders', nome: 'Ordini e Magazzino', area: 'OPERATIONS',
    campi: 'orders.orders in stato INVIATO (in attesa di approvazione): submitted_at + soglia ordini_giorni, urgente, struttura (strutture_v)',
    async leggi({ da, a, imp, db }) {
      const N = Number(imp.ordini_giorni) || 2;
      const rows = await db.many(`SELECT o.id, o.number, o.kind, o.urgent, o.urgent_reason, (o.submitted_at AT TIME ZONE 'Europe/Rome')::date AS inviato, st.name AS struttura
          FROM orders o LEFT JOIN strutture_v st ON st.id = o.struttura_id WHERE o.status = 'INVIATO' AND o.submitted_at IS NOT NULL`);
      return rows.map((o) => ({ o, d: addGiorni(iso(o.inviato), N) })).filter(({ d }) => d >= da && d <= a).map(({ o, d }) => ({
        chiave: `approvazione:${o.id}`, data: d, tipo: 'Ordine da approvare', titolo: `Ordine ${o.number} in attesa di approvazione da più di ${N} giorni${o.urgent ? ' (urgente)' : ''}`,
        descrizione: `Inviato il ${itData(iso(o.inviato))}${o.urgent_reason ? ` · ${o.urgent_reason}` : ''}`, oggetto: o.struttura, gravita: o.urgent ? 'ALTA' : 'MEDIA', link: `/orders/ordini/${o.id}`, responsabile: 'Area Operations',
      }));
    },
  },
  {
    key: 'room', modulo: 'room', nome: 'Room Planning · professionisti', area: 'RETAIL_FLOW',
    campi: 'room.professionista_docs.scadenza (ultimo documento per tipo), person_ext.dati.assicurazione.scadenza (polizza RC), person_ext.dati.contratto.al (fine collaborazione); persone attive',
    async leggi({ da, a, db }) {
      const out = [];
      const docs = await db.many(`SELECT d.id, d.person_id, d.tipo, d.nome, d.scadenza, p.last_name || ' ' || p.first_name AS persona FROM professionista_docs d JOIN public.people p ON p.id = d.person_id
         WHERE p.status = 'ATTIVO' AND d.scadenza BETWEEN $1 AND $2 AND NOT EXISTS (SELECT 1 FROM professionista_docs d2 WHERE d2.person_id = d.person_id AND d2.tipo = d.tipo AND d2.scadenza > d.scadenza)`, [da, a]);
      for (const d of docs) out.push({ chiave: `doc:${d.id}`, data: d.scadenza, tipo: 'Documento del professionista', titolo: `Scadenza documento ${String(d.tipo).toLowerCase().replace(/_/g, ' ')}: ${d.nome}`, oggetto: d.persona, gravita: 'MEDIA', link: '/room/professionisti' });
      const ext = await db.many(`SELECT e.person_id, e.dati->'assicurazione'->>'scadenza' AS polizza, e.dati->'contratto'->>'al' AS fine, p.last_name || ' ' || p.first_name AS persona
          FROM person_ext e JOIN public.people p ON p.id = e.person_id WHERE p.status = 'ATTIVO'`);
      for (const x of ext) {
        const pz = iso(x.polizza), fi = iso(x.fine);
        if (pz && pz >= da && pz <= a) out.push({ chiave: `polizza:${x.person_id}:${pz}`, data: pz, tipo: 'Polizza RC del professionista', titolo: 'Scadenza della polizza RC professionale', oggetto: x.persona, gravita: 'ALTA', link: '/room/professionisti' });
        if (fi && fi >= da && fi <= a) out.push({ chiave: `contratto:${x.person_id}:${fi}`, data: fi, tipo: 'Contratto del professionista', titolo: 'Fine della collaborazione (contratto a termine)', oggetto: x.persona, gravita: 'MEDIA', link: '/room/professionisti' });
      }
      return out;
    },
  },
  {
    key: 'circolari', modulo: 'circolari', nome: 'Circolari', area: 'HQS',
    campi: 'circolari.circolari PUBBLICATA del segmento PERSONALE (published_at + soglia circolari_giorni), circolari.prese_visione, utenti interni attivi della Suite (stessa regola isInterno del modulo)',
    async leggi({ da, a, imp, db }) {
      const N = Number(imp.circolari_giorni) || 7;
      const circ = (await db.many(`SELECT c.id, c.protocollo, c.titolo, (c.published_at AT TIME ZONE 'Europe/Rome')::date AS pubblicata FROM circolari c
          WHERE c.stato = 'PUBBLICATA' AND c.segmento = 'PERSONALE' AND c.published_at IS NOT NULL`)).map((c) => ({ ...c, d: addGiorni(iso(c.pubblicata), N) })).filter((c) => c.d >= da && c.d <= a);
      if (!circ.length) return [];
      const { isInterno } = await import('../modules/circolari/lib/visibilita.js');
      const utenti = (await many(`SELECT u.id, u.level, u.is_external, p.kind AS person_kind, o.kind AS organization_kind FROM public.users u LEFT JOIN public.people p ON p.id = u.person_id
          LEFT JOIN public.organizations o ON o.id = coalesce(p.organization_id, u.organization_id) WHERE u.status = 'ACTIVE'`)).filter(isInterno).map((u) => u.id);
      const prese = await db.many(`SELECT circolare_id, user_id FROM prese_visione WHERE circolare_id = ANY($1::int[])`, [circ.map((c) => c.id)]);
      const out = [];
      for (const c of circ) {
        const lette = new Set(prese.filter((p) => p.circolare_id === c.id).map((p) => p.user_id));
        const mancano = utenti.filter((u) => !lette.has(u)).length;
        if (!mancano) continue;
        out.push({ chiave: `presa:${c.id}`, data: c.d, tipo: 'Presa visione', titolo: `Presa visione non confermata: ${c.protocollo || ''} ${c.titolo}`.replace(/\s+/g, ' '),
          descrizione: `${mancano} su ${utenti.length} utenti interni non hanno confermato; pubblicata il ${itData(iso(c.pubblicata))}`, oggetto: 'Personale', gravita: 'BASSA', link: `/circolari/${c.id}`, responsabile: 'Redazione circolari' });
      }
      return out;
    },
  },
  {
    key: 'integration', modulo: 'integration', nome: 'Integration M&A', area: 'FINANCE',
    campi: 'integration.activities non completate (st < 3) con data di fine (fine AAAA-MM-GG), target (targets_v)',
    async leggi({ da, a, db }) {
      const rows = await db.many(`SELECT x.id, x.target_id, x.nome, x.fine, x.st, t.nome AS target FROM activities x JOIN targets_v t ON t.id = x.target_id
          WHERE x.st < 3 AND x.fine ~ '^\\d{4}-\\d{2}-\\d{2}$' AND x.fine::date BETWEEN $1 AND $2`, [da, a]);
      const testo = (v) => (v == null ? '' : typeof v === 'string' ? v : v.it || v.label || Object.values(v).find((s) => typeof s === 'string') || '');
      return rows.map((x) => ({ chiave: `attivita:${x.target_id}:${x.id}`, data: x.fine, tipo: 'Attività di integrazione', titolo: `Fine prevista: ${testo(x.nome) || 'attività'}`, oggetto: x.target, gravita: 'MEDIA', link: '/integration' }));
    },
  },
];
// Fonti valutate e scartate (motivo nella pagina e in docs/COCKPIT.md): nessuna data di scadenza vera da leggere
export const FONTI_SCARTATE = [
  { modulo: 'core', nome: 'Autorizzazioni sanitarie delle sedi', motivo: 'public.sites non ha una data di autorizzazione o di scadenza; le autorizzazioni vivono nei fascicoli del Business Hub (business.dossiers), che non hanno una data di scadenza: si legge l\'avvio previsto del punto con il fascicolo non autorizzato' },
  { modulo: 'audit', nome: 'Audit pianificati', motivo: 'audit.audits non ha una data di pianificazione (solo conducted_at a cose fatte): compaiono gli auto-audit mensili mancanti e le azioni sulle NC con data "entro"' },
  { modulo: 'shipments', nome: 'Spedizioni e Kit', motivo: 'kit e lotti non hanno una data di scadenza (stock_lots ha solo received_at)' },
  { modulo: 'retail', nome: 'Retail Assistant', motivo: 'le uniche date future sono i richiami periodici dei pazienti (periodicità del prodotto), dato commerciale per paziente e non scadenza di direzione' },
  { modulo: 'cash', nome: 'Cash Management', motivo: 'rendiconti e versamenti non hanno una scadenza registrata (il contatore "da approvare" resta nella Home)' },
  { modulo: 'ticket', nome: 'Ticket', motivo: 'gli SLA dei ticket sono operativi e gestiti dal modulo (escalation automatica), non scadenze di direzione' },
];

// ------------------------------------------------------------------ funzione unica
const cache = new Map();   // chiave → { at, data }: 3 minuti, al massimo 20 finestre
const CACHE_MS = 3 * 60_000;
export const svuotaCacheScadenzario = () => cache.clear();

/**
 * Scadenze di direzione tra `da` e `a` (ISO, predefinito da 30 giorni fa a 90 giorni avanti) per le aree indicate (array di chiavi
 * AREE, predefinito tutte). Ritorna { da, a, oggi, generated_at, righe (ordinate per data), fonti: [{ key, modulo, nome, area, campi,
 * stato: OK | NON_ATTIVO | ERRORE, nota, righe }], scartate }. Le righe non sono filtrate per utente: visibiliA() e applicaViste() nella route.
 */
export async function scadenzeDirezione({ da, a, aree, oggi = oggiRoma(), fresco = false } = {}) {
  const f = finestraPredefinita(oggi);
  const D = iso(da) || f.da, A = iso(a) || f.a;
  if (A < D) throw Object.assign(new Error('Intervallo non valido: la data finale precede quella iniziale'), { status: 400 });
  if (giorniTra(D, A) > 800) throw Object.assign(new Error('Intervallo troppo ampio (massimo 800 giorni)'), { status: 400 });
  const ar = Array.isArray(aree) && aree.length ? aree.filter((x) => AREE[x]) : null;
  const key = `${D}|${A}|${oggi}|${ar ? ar.join(',') : '*'}`;
  const c = cache.get(key);
  if (!fresco && c && Date.now() - c.at < CACHE_MS) return c.data;
  const imp = await impostazioni();
  const fonti = [];
  const righe = [];
  await Promise.all(FONTI.filter((x) => !ar || ar.includes(x.area)).map(async (fonte) => {
    const meta = { key: fonte.key, modulo: fonte.modulo || 'core', nome: fonte.nome, area: fonte.area, campi: fonte.campi };
    if (fonte.modulo) {
      const st = await statoModulo(fonte.modulo);
      if (st !== 'LIVE') { fonti.push({ ...meta, stato: 'NON_ATTIVO', nota: st === 'OFF' ? 'Modulo non avviato nella Suite' : `Modulo in stato ${st}: si legge solo quando è LIVE`, righe: 0 }); return; }
    }
    try {
      const raw = await fonte.leggi({ da: D, a: A, oggi, imp, db: fonte.modulo ? moduleDb(fonte.modulo) : null });
      const rr = raw.map((x) => riga(fonte, x, oggi)).filter(Boolean);
      righe.push(...rr);
      fonti.push({ ...meta, stato: 'OK', nota: null, righe: rr.length });
    } catch (e) {
      console.warn(`[scadenzario:${fonte.key}] lettura non riuscita: ${e.message}`);
      fonti.push({ ...meta, stato: 'ERRORE', nota: `Lettura non riuscita: ${String(e.message).slice(0, 200)}`, righe: 0 });
    }
  }));
  // stessa chiave due volte (es. due eventi identici della stessa fonte): una riga sola
  const viste = new Set();
  const uniche = righe.filter((r) => (viste.has(r.id) ? false : viste.add(r.id)));
  const ordineFonti = FONTI.map((x) => x.key);
  const data = { da: D, a: A, oggi, generated_at: new Date().toISOString(), righe: ordina(uniche), fonti: fonti.sort((x, y) => ordineFonti.indexOf(x.key) - ordineFonti.indexOf(y.key)), scartate: FONTI_SCARTATE };
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 20) cache.delete(cache.keys().next().value);
  return data;
}

// ------------------------------------------------------------------ per utente: viste, contatore della Home, card del Cockpit
export async function visteUtente(userId, oggi = oggiRoma()) {
  return many(`SELECT chiave, fino_a FROM public.cockpit_scadenze_viste WHERE user_id = $1 AND fino_a >= $2`, [userId, oggi]).catch(() => []);
}
export const puoVedere = (user) => user?.level === 'OWNER' || user?.level === 'ADMIN' || Boolean(user?.grants?.cockpit);

/** Scadenze della finestra predefinita visibili all'utente, senza quelle segnate viste. */
export async function righeUtente(user, { oggi = oggiRoma() } = {}) {
  const d = await scadenzeDirezione({ oggi });
  const vv = await visteUtente(user.id, oggi);
  return applicaViste(visibiliA(d.righe, user), vv, oggi).filter((r) => !r.vista_fino_a);
}
/** Contatore della Home (card Cockpit): scadenze da oggi a 7 giorni non segnate viste; null a chi non vede il Cockpit. */
export async function contatoreHome(user) {
  if (!puoVedere(user)) return null;
  const rip = riepilogo(await righeUtente(user));
  return { value: rip.entro_7, label: rip.SCADUTA ? `Entro 7 gg, ${rip.SCADUTA} scadute` : 'Entro 7 giorni' };
}

// ------------------------------------------------------------------ job core:scadenzario (notifica giornaliera)
/** Testo della notifica: conteggi e le prime scadenze entro 7 giorni (pure, testata). */
export function testoNotifica(righe) {
  const r7 = righe.filter((r) => r.stato === 'OGGI' || r.stato === 'ENTRO_7');
  if (!r7.length) return null;
  const scadute = righe.filter((r) => r.stato === 'SCADUTA').length;
  const oggiN = r7.filter((r) => r.stato === 'OGGI').length;
  const title = `Scadenzario di direzione: ${r7.length} ${r7.length === 1 ? 'scadenza' : 'scadenze'} entro 7 giorni`;
  const prime = ordina(r7).slice(0, 6).map((r) => `${itData(r.data).slice(0, 5)} ${r.titolo}${r.oggetto ? ` (${r.oggetto})` : ''}`);
  const body = [`${oggiN} oggi, ${r7.length - oggiN} nei prossimi 7 giorni${scadute ? `, ${scadute} già scadute` : ''}.`, ...prime, r7.length > prime.length ? `e altre ${r7.length - prime.length}.` : null].filter(Boolean).join(' · ');
  return { title, body };
}
/**
 * Una volta al giorno, dopo l'ora impostata (Europe/Rome), se ci sono scadenze entro 7 giorni: notifica in app al titolare (CEO) e agli
 * amministratori, ognuno con le righe che può vedere e senza quelle segnate viste. Il giorno si "prenota" in cockpit_scadenzario_invii
 * (chiave primaria): con più istanze del server parte una sola notifica.
 */
export async function eseguiNotificaScadenzario({ ora = new Date(), forza = false } = {}) {
  const imp = await impostazioni();
  if (!imp.notifica_attiva && !forza) return { skipped: 'notifica spenta (Amministrazione > Impostazioni > cockpit.scadenzario)' };
  const oggi = oggiRoma(ora);
  const h = Number(ora.toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false }));
  if (!forza && h < (Number(imp.notifica_ora) || 8)) return { skipped: `prima delle ${Number(imp.notifica_ora) || 8}` };
  if (!forza && await one('SELECT 1 FROM public.cockpit_scadenzario_invii WHERE giorno = $1', [oggi])) return { skipped: 'notifica di oggi già inviata' };
  const { notify } = await import('./community.js');
  const { hydrateUser } = await import('./access.js');
  const ids = (await many(`SELECT id FROM public.users WHERE status = 'ACTIVE' AND level IN ('OWNER','ADMIN') ORDER BY id`)).map((u) => u.id);
  let utenti = 0; let righeTot = 0;
  const per = [];
  for (const id of ids) {
    const u = await hydrateUser(id);
    if (!u) continue;
    const rr = await righeUtente(u, { oggi });
    const t = testoNotifica(rr);
    if (t) per.push({ id, t, n: rr.filter((r) => r.stato === 'OGGI' || r.stato === 'ENTRO_7').length });
  }
  if (!per.length) return { giorno: oggi, utenti: 0, skipped: 'nessuna scadenza entro 7 giorni' };
  // prenotazione del giorno: se un'altra istanza l'ha già presa, niente doppioni
  const pren = await one(`INSERT INTO public.cockpit_scadenzario_invii (giorno, utenti, righe) VALUES ($1, 0, 0) ON CONFLICT (giorno) DO NOTHING RETURNING giorno`, [oggi]);
  if (!pren && !forza) return { skipped: 'notifica di oggi già inviata' };
  for (const p of per) { utenti += await notify([p.id], { kind: 'AVVISO', module_key: 'cockpit', title: p.t.title, body: p.t.body, link: '/cockpit' }); righeTot = Math.max(righeTot, p.n); }
  await q(`INSERT INTO public.cockpit_scadenzario_invii (giorno, utenti, righe) VALUES ($1, $2, $3) ON CONFLICT (giorno) DO UPDATE SET utenti = EXCLUDED.utenti, righe = EXCLUDED.righe, at = now()`, [oggi, utenti, righeTot]);
  return { giorno: oggi, utenti, scadenze: righeTot };
}
export function registerScadenzarioJobs(registerJob) {
  // ogni 30 minuti: la funzione decide da sola se è il momento (dopo le 8, una volta al giorno, solo se ci sono scadenze)
  registerJob('core:scadenzario', 30, () => eseguiNotificaScadenzario(), { runAtStart: false });
}
