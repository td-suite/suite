// Business Hub ↔ StudioLab (Synclab Data API), richiesta del CEO del 09/11/2026 sera (v0.68.1), rivista il 10/11/2026 (v0.68.5): per i
// clienti Service e MdL con la Legal entity abbinata a un client Synclab (synclab.clients_td) la scheda account, la Pipeline e il Cruscotto
// mostrano ciò che il gestionale ha davvero registrato accanto a ciò che è stato dichiarato nella scheda (fatturato_fy_atteso).
//
// Regole (nessun numero inventato, fonti dichiarate):
//  - MATURATO dell'anno = PRODUZIONE EROGATA (v0.68.5, CEO: "Maturato 2026: NON il fatturato ma il valore netto, cioè il valore della
//    produzione erogata per mese, aggiornato per singolo giorno"): accettazioni in stato erogato con data nell'anno fino a oggi, valore =
//    Σ netto di riga × quantità × (1 − sconto di testata) (lib/synclab/letture.js produzionePerOrg / produzioneGiornaliera, definizione
//    unica); mese per mese e, per il mese in corso, giorno per giorno;
//  - documenti emessi (fatturato da documenti, contributo netto una volta per documento) = dato SECONDARIO, mostrato a parte, mai sommato;
//  - pro quota dell'anno = fatturato_fy_atteso × giorni lavorativi (lun-ven) dall'avvio a oggi / giorni lavorativi dell'anno (250,
//    impostazione hub_giorni_lavorativi, come volumiGiornalieri); avvio = data di avvio effettiva, prevista o di cliente attivo, oppure
//    il 1° gennaio se è precedente (o se manca);
//  - run rate dell'anno seguente = media mensile della produzione erogata degli ultimi 3 mesi pieni × 12, solo con almeno 2 mesi pieni;
//    mese pieno = mese interamente trascorso e interamente dopo l'avvio (senza avvio: dopo il mese della prima accettazione erogata);
//  - semaforo dello scostamento sul pro quota: verde entro ±10% (o sopra), giallo fino a −25%, rosso oltre −25%.
// Le funzioni pure sono testate in server/test/v0681-correlazioni.test.mjs e v0685-produzione-erogata.test.mjs.
import { many, one } from '../db.js';

const iso = (d) => d.toISOString().slice(0, 10);
const giorno = (v) => (v == null || v === '' ? null : (v instanceof Date ? iso(v) : String(v).slice(0, 10)));
const r2 = (n) => (n == null ? null : Math.round((Number(n) + Number.EPSILON) * 100) / 100);
const pct = (num, den) => (num == null || den == null || !Number(den) ? null : Math.round((Number(num) / Number(den)) * 1000) / 10);
export const MESI_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const etichettaMese = (mk) => `${MESI_IT[Number(mk.slice(5, 7)) - 1]} ${mk.slice(0, 4)}`;

// Giorni lavorativi, data di avvio e pro quota sono in lib/proQuota.js (pure, senza database: le usa anche Finance Management, v0.68.4)
import { giorniLavorativi, dataAvvio, proQuota } from './proQuota.js';
export { giorniLavorativi, dataAvvio, proQuota };

/** Mesi 'AAAA-MM' interamente trascorsi prima del mese di oggi e interamente dopo l'inizio (inizio = primo giorno utile). */
export function mesiPieni(inizio, oggi) {
  if (!inizio) return [];
  const out = [];
  const meseOggi = String(oggi).slice(0, 7);
  let [y, m] = String(inizio).slice(0, 7).split('-').map(Number);
  if (String(inizio).slice(8, 10) !== '01') { m += 1; if (m > 12) { m = 1; y += 1; } }
  for (let i = 0; i < 600; i++) {
    const mk = `${y}-${String(m).padStart(2, '0')}`;
    if (mk >= meseOggi) break;
    out.push(mk);
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/**
 * Run rate annuo: media mensile degli ultimi 3 mesi pieni × 12, con almeno 2 mesi pieni.
 * mensile: { 'AAAA-MM': fatturato } (mesi assenti = 0, sono mesi in cui il cliente era avviato e non ha documenti).
 */
export function runRate({ mensile = {}, inizio, oggi, fatturato_fy_atteso: fy = null }) {
  const pieni = mesiPieni(inizio, oggi);
  const usati = pieni.slice(-3);
  const anno = Number(String(oggi).slice(0, 4)) + 1;
  if (usati.length < 2) {
    return { anno, calcolabile: false, mesi: usati, media_mensile: null, importo: null, scostamento: null, scostamento_pct: null,
      nota: usati.length === 1 ? `Un solo mese pieno (${etichettaMese(usati[0])}): run rate non calcolabile, servono almeno 2 mesi` : 'Nessun mese pieno dopo l\'avvio: run rate non calcolabile, servono almeno 2 mesi' };
  }
  const media = usati.reduce((t, mk) => t + Number(mensile[mk] || 0), 0) / usati.length;
  const importo = r2(media * 12);
  const s = fy != null && Number(fy) > 0 ? r2(importo - Number(fy)) : null;
  return { anno, calcolabile: true, mesi: usati, media_mensile: r2(media), importo, scostamento: s, scostamento_pct: s == null ? null : pct(s, fy),
    nota: usati.length < 3 ? `Solo ${usati.length} mesi pieni (${usati.map(etichettaMese).join(', ')}): stima fragile` : `Ultimi 3 mesi pieni: ${usati.map(etichettaMese).join(', ')}` };
}

/** Semaforo dello scostamento % sul pro quota: verde entro ±10% (o sopra), giallo fino a −25%, rosso oltre. */
export function semaforo(scostPct) {
  if (scostPct == null) return null;
  if (scostPct >= -10) return 'VERDE';
  if (scostPct >= -25) return 'GIALLO';
  return 'ROSSO';
}
export const IN_RITARDO = (s) => s === 'GIALLO' || s === 'ROSSO';

/**
 * Confronto di un account con i dati del gestionale (puro). prod: Map 'AAAA-MM' → sintesi di produzionePerOrg (produzione erogata, solo
 * quell'organizzazione); fat: Map 'AAAA-MM' → sintesi di fatturatoPerOrg (documenti emessi, secondari). primoProd: data della prima
 * accettazione erogata nella copia (inizio del run rate senza data di avvio).
 */
export function confronta({ account, fat = new Map(), prod = new Map(), oggi, giorniAnno = 250, primoProd = null, primoDoc = null }) {
  const anno = String(oggi).slice(0, 4);
  const mesi = [];
  for (let m = 1; m <= Number(String(oggi).slice(5, 7)); m++) mesi.push(`${anno}-${String(m).padStart(2, '0')}`);
  const righe = mesi.map((mk) => {
    const f = fat.get(mk) || null, p = prod.get(mk) || null;
    return { mese: mk, etichetta: etichettaMese(mk), produzione: p?.valore != null ? r2(p.valore) : null, esami: p?.esami || 0, accettazioni: p?.accettazioni ?? null,
      righe_senza_prezzo: p?.righe_senza_prezzo || 0, documenti_emessi: f?.fatturato != null ? r2(f.fatturato) : null, documenti: f?.documenti || 0, note_credito: f?.note_credito || 0,
      in_corso: mk === String(oggi).slice(0, 7) };
  });
  const somma = (k) => { const v = righe.filter((x) => x[k] != null); return v.length ? r2(v.reduce((t, x) => t + Number(x[k]), 0)) : null; };
  const maturato = somma('produzione');
  const avvio = dataAvvio(account);
  const pq = proQuota({ fatturato_fy_atteso: account.fatturato_fy_atteso, avvio, oggi, giorniAnno });
  const scost = pq && maturato != null ? r2(maturato - pq.importo) : pq ? r2(0 - pq.importo) : null;
  const scostPct = pq && pq.importo > 0 ? pct(scost, pq.importo) : null;
  const mensile = Object.fromEntries(righe.map((x) => [x.mese, x.produzione || 0]));
  // per il run rate servono anche i mesi dell'anno prima (fino a 3 mesi indietro a inizio anno)
  for (const [mk, p] of prod) if (!(mk in mensile)) mensile[mk] = p?.valore != null ? Number(p.valore) : 0;
  const primo = primoProd || primoDoc;
  const inizioRR = avvio || (primo ? giorno(primo) : null);
  const rr = runRate({ mensile, inizio: inizioRR, oggi, fatturato_fy_atteso: account.fatturato_fy_atteso });
  const conDati = righe.filter((x) => x.produzione != null || x.esami > 0);
  const ultimo = conDati.length ? conDati[conDati.length - 1] : null;
  return {
    anno: Number(anno), oggi, maturato, grandezza: 'PRODUZIONE_EROGATA',
    produzione: { esami: righe.reduce((t, x) => t + x.esami, 0), valore: maturato, accettazioni: righe.reduce((t, x) => t + Number(x.accettazioni || 0), 0), righe_senza_prezzo: righe.reduce((t, x) => t + x.righe_senza_prezzo, 0) },
    documenti_emessi: { importo: somma('documenti_emessi'), documenti: righe.reduce((t, x) => t + x.documenti, 0), nota: 'Dato secondario: documenti economici del gestionale (contributo netto, una volta per documento), non sommati alla produzione' },
    documenti: righe.reduce((t, x) => t + x.documenti, 0),
    ultimo_mese: ultimo, mesi: righe, avvio,
    pro_quota: pq, scostamento: pq ? scost : null, scostamento_pct: scostPct, semaforo: semaforo(scostPct),
    run_rate: { ...rr, senza_avvio: !avvio, inizio: inizioRR },
    dichiarato: account.fatturato_fy_atteso != null ? Number(account.fatturato_fy_atteso) : null,
  };
}

/** Giorni lavorativi dell'anno dalle impostazioni del Business Hub (hub_giorni_lavorativi, predefinito 250). */
export async function giorniAnnoHub() {
  const r = await one(`SELECT value FROM app_settings WHERE key = 'hub_giorni_lavorativi'`).catch(() => null);
  return Number(r?.value) > 0 ? Number(r.value) : 250;
}

/**
 * Correlazione per un elenco di account (Service e MdL): Map account_id → confronto, solo per le Legal entity abbinate a un client
 * Synclab con documenti o accettazioni importati. { disponibile, nota, per_account, stato }.
 */
export async function correlazioneAccounts(accounts, { oggi }) {
  const out = { disponibile: false, nota: null, per_account: new Map(), stato: null };
  const acc = (accounts || []).filter((a) => ['SRV', 'MDL'].includes(a.linea));
  if (!acc.length) return out;
  const L = await import('../../../lib/synclab/letture.js');
  const d = await L.disponibilita();
  if (!d || !d.requests) { out.nota = 'Nessuna accettazione Synclab importata (Amministrazione > Connettori > StudioLAB > Dati Synclab)'; return out; }
  const orgIds = [...new Set(acc.map((a) => Number(a.organization_id)))];
  const abbinate = new Set((await many(`SELECT DISTINCT organization_id FROM synclab.clients_td WHERE organization_id = ANY($1::int[])`, [orgIds])).map((x) => Number(x.organization_id)));
  if (!abbinate.size) { out.disponibile = true; out.nota = 'Nessuna di queste Legal entity è abbinata a un client Synclab'; return out; }
  const ids = [...abbinate];
  const anno = String(oggi).slice(0, 4);
  const da = `${Number(anno) - 1}-10-01`;   // tre mesi dell'anno prima per il run rate di inizio anno
  const stati = await L.statiErogati();
  const [fat, prod, primi, giorniAnno, stato] = await Promise.all([
    d.invoices ? L.fatturatoPerOrg(ids, `${anno}-01-01`, oggi) : new Map(), L.produzionePerOrg(ids, da, oggi, { stati }),
    many(`SELECT m.organization_id AS org_id, min(r.date)::text AS primo FROM synclab.clients_td m JOIN synclab.requests r ON r.instance_id = m.instance_id AND r.client_id = m.client_id
      WHERE m.organization_id = ANY($1::int[]) AND r.disponibilita = 'ATTIVO' AND r.deleted_at IS NULL AND r.state = ANY($2::int[]) GROUP BY 1`, [ids, stati]),
    giorniAnnoHub(), L.statoCopia().catch(() => null),
  ]);
  out.disponibile = true; out.stato = stato; out.stati = stati;
  const perOrg = (mappa, org) => { const m = new Map(); for (const [k, v] of mappa) { const [o, mk] = k.split('|'); if (Number(o) === Number(org)) m.set(mk, v); } return m; };
  for (const a of acc) {
    if (!abbinate.has(Number(a.organization_id))) continue;
    const c = confronta({ account: a, fat: perOrg(fat, a.organization_id), prod: perOrg(prod, a.organization_id), oggi, giorniAnno, primoProd: primi.find((x) => Number(x.org_id) === Number(a.organization_id))?.primo || null });
    out.per_account.set(a.id, c);
  }
  return out;
}

/**
 * Blocco della scheda account: confronto (maturato = produzione erogata), progressione giornaliera del mese, client Synclab abbinati, fonte
 * con le date della copia; { applicabile: false, motivo } se non abbinato.
 */
export async function bloccoAccount(a, { oggi }) {
  if (!['SRV', 'MDL'].includes(a.linea)) return { applicabile: false, motivo: 'Solo per i clienti Service e Medicina del Lavoro' };
  const clients = await many(`SELECT v.client_id, v.client_code, v.legal_name, v.active, v.stato_abbinamento, v.site_id, s.name AS site_name, s.code AS site_code, s.studiolab_code
      FROM synclab.clients_td v LEFT JOIN public.sites s ON s.id = v.site_id WHERE v.organization_id = $1 ORDER BY v.client_code`, [a.organization_id]).catch(() => []);
  if (!clients.length) return { applicabile: false, motivo: 'La Legal entity non è abbinata a un client Synclab (Amministrazione > Connettori > StudioLAB > Dati Synclab > Clienti Synclab, oppure "Abbina al cliente del gestionale" qui sotto)' };
  const c = await correlazioneAccounts([a], { oggi });
  const x = c.per_account.get(a.id) || null;
  const L = await import('../../../lib/synclab/letture.js');
  const giornaliero = x ? await L.produzioneGiornaliera({ da: `${String(oggi).slice(0, 7)}-01`, a: oggi, chiave: String(a.organization_id), stati: c.stati }).catch(() => null) : null;
  const cp = c.stato?.insiemi || {};
  const data = (k) => (cp[k]?.checkpoint_at ? new Date(cp[k].checkpoint_at).toISOString() : null);
  return {
    applicabile: true, disponibile: Boolean(x), nota: c.nota, clients, confronto: x, stati: c.stati || null,
    giornaliero: giornaliero ? { giorni: giornaliero.giorni.map((g) => ({ giorno: g.giorno, valore: g.valore, esami: g.esami, accettazioni: g.accettazioni })), totale: giornaliero.totale } : null,
    chiave_b2b: String(a.organization_id),
    fonte: {
      testo: L.fonteProduzione(c.stati || L.STATI_EROGATI_PREDEFINITI, cp.requests?.checkpoint_at || null),
      aggiornato: L.aggiornatoAlle(cp.requests?.checkpoint_at || null, oggi),
      checkpoint_documenti: data('invoices'), checkpoint_accettazioni: data('requests'),
      documenti: 'Documenti emessi (secondari): contributo netto dei documenti economici, una volta per documento, data del documento; mai sommati alla produzione',
      dichiarato: 'Fatturato FY atteso della scheda (Dati economici)',
    },
  };
}

// ------------------------------------------------------------------ v0.68.5: listino del gestionale e abbinamento dalla scheda account
/** Listino corrente del Business Hub della Legal entity (account SRV, poi MDL): Map codice → { prezzo (offerto, altrimenti listino), … }. */
export async function listinoHubDi(orgId) {
  const { versioneCorrente } = await import('./listino.js');
  const acc = await many(`SELECT id, linea, listino_corrente_id FROM accounts WHERE organization_id = $1 AND linea IN ('SRV','MDL') ORDER BY (linea = 'SRV') DESC, id`, [orgId]);
  for (const a of acc) {
    const v = versioneCorrente(await many('SELECT id, account_id, versione, righe, caricato_at FROM listini WHERE account_id = $1', [a.id]), a.listino_corrente_id);
    if (!v) continue;
    const prezzi = new Map();
    const num = (y) => (y == null || y === '' || !Number.isFinite(Number(y)) ? null : Number(y));
    for (const x of Array.isArray(v.righe) ? v.righe : []) {
      const cod = String(x.codice || '').trim().toUpperCase(); if (!cod) continue;
      prezzi.set(cod, { prezzo: num(x.offerto) ?? num(x.listino), offerto: num(x.offerto), listino: num(x.listino), descrizione: x.descrizione || null });
    }
    return { account_id: a.id, linea: a.linea, listino_id: v.id, versione: v.versione, prezzi };
  }
  return null;
}

/** Sezione "Listino del gestionale (Synclab)" della scheda account: listini dei client abbinati con anteprima e confronto con il Business Hub. */
export async function listinoGestionaleAccount(a, { tutte = false } = {}) {
  const L = await import('../../../lib/synclab/listini.js');
  const dati = await L.listiniDiOrg(a.organization_id, { anteprima: 8, tutte: true });
  if (!dati.clients.length) return { applicabile: false, motivo: 'La Legal entity non è abbinata a un client Synclab', clients: [] };
  const hub = await listinoHubDi(a.organization_id);
  const confronti = [];
  for (const c of dati.clients) for (const l of c.listini) {
    const k = L.confrontoConHub(l.tutte || [], hub?.prezzi || new Map());
    confronti.push({ client_id: c.client_id, client_code: c.client_code, ruolo: l.ruolo, code: l.code, confronto: k });
    l.confronto = { diverse: k.diverse, uguali: k.uguali, solo_synclab: k.solo_synclab, solo_hub: k.solo_hub, righe: k.righe.filter((x) => x.esito === 'DIVERSO').slice(0, 30) };
    if (!tutte) delete l.tutte;
  }
  const stato = await one(`SELECT max(checkpoint_at) AS t FROM synclab.sync_scope WHERE dataset = 'price-lists'`).catch(() => null);
  return { applicabile: true, ...dati, hub: hub ? { versione: hub.versione, linea: hub.linea, esami: hub.prezzi.size } : null, confronti, checkpoint_listini: stato?.t || null };
}
