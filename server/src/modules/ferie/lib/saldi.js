// Saldo ferie di una persona in un anno: spettanza pro rata dei mesi lavorati, maturato a oggi, residuo dell'anno precedente,
// goduto, pianificato, in attesa, residuo, quota dell'anno precedente ancora da smaltire, rischio di residui non pianificati.
// Funzioni pure (nessun database): testate in server/test/ferie.test.mjs.
//
// Ipotesi dichiarate (impostazioni del modulo, da verificare con il consulente del lavoro):
// - un mese conta come lavorato se il rapporto copre almeno `soglia_mese_giorni` giorni di calendario del mese (predefinito 15);
// - la spettanza annua è giorni_annui × mesi lavorati nell'anno / 12 (assunzione e cessazione nell'anno riducono la spettanza);
// - il maturato a oggi conta i mesi lavorati già conclusi;
// - i giorni goduti nell'anno consumano prima il residuo dell'anno precedente (FIFO).
import { parseIso, isoDate } from './calendario.js';

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const fineMese = (anno, mese) => isoDate(new Date(Date.UTC(anno, mese, 0)));   // mese 1..12

/** Giorni di calendario del mese coperti dal rapporto [inizio, fine] (date ISO, fine facoltativa) */
export function giorniCopertiNelMese(anno, mese, inizio, fine) {
  const m0 = `${anno}-${String(mese).padStart(2, '0')}-01`, m1 = fineMese(anno, mese);
  const a = inizio && inizio > m0 ? inizio : m0;
  const b = fine && fine < m1 ? fine : m1;
  if (b < a) return 0;
  return Math.round((parseIso(b) - parseIso(a)) / 86400000) + 1;
}

/**
 * Mesi lavorati nell'anno (1..12) dati inizio e fine del rapporto. finoA (data ISO, facoltativa): conta solo i mesi conclusi entro
 * quella data (per il maturato a oggi). Ritorna l'elenco dei mesi che contano.
 */
export function mesiLavorati(anno, { inizio = null, fine = null, finoA = null, soglia = 15 } = {}) {
  const out = [];
  for (let m = 1; m <= 12; m++) {
    if (finoA && fineMese(anno, m) > finoA) break;
    if (giorniCopertiNelMese(anno, m, inizio, fine) >= soglia) out.push(m);
  }
  return out;
}

/** Spettanza dell'anno (pro rata) e maturato a oggi */
export function spettanza(anno, giorniAnnui, { inizio = null, fine = null, oggi = null, soglia = 15 } = {}) {
  const g = Number(giorniAnnui || 0);
  const mesi = mesiLavorati(anno, { inizio, fine, soglia });
  const fino = oggi && Number(oggi.slice(0, 4)) === anno ? oggi : (oggi && Number(oggi.slice(0, 4)) < anno ? `${anno - 1}-12-31` : null);
  const mesiMaturati = fino ? mesiLavorati(anno, { inizio, fine, finoA: fino, soglia }) : mesi;
  return { mesi: mesi.length, spettanza: r2((g * mesi.length) / 12), mesi_maturati: mesiMaturati.length, maturato: r2((g * mesiMaturati.length) / 12) };
}

/**
 * Saldo complessivo (piano annuale). goduto = giorni approvati con data passata (fino a oggi compreso); pianificato = giorni del piano
 * non ancora goduti (pianificato futuro); in_attesa = giorni delle variazioni non ancora decise.
 * residuo = residuo_ap + spettanza − goduto − pianificato; disponibile = da_pianificare = residuo − in_attesa (giorni che il dipendente
 * ha ancora da mettere nel piano); pianificato_totale = goduto + pianificato (somma dei periodi del piano dell'anno).
 */
export function saldo({ residuo_ap = 0, spettanza: sp = 0, maturato = 0, goduto = 0, pianificato = 0, in_attesa = 0 }) {
  const residuo = r2(Number(residuo_ap) + Number(sp) - Number(goduto) - Number(pianificato));
  const apDaSmaltire = r2(Math.max(0, Number(residuo_ap) - Number(goduto) - Number(pianificato)));   // FIFO: prima l'anno precedente
  const apNonGoduto = r2(Math.max(0, Number(residuo_ap) - Number(goduto)));
  return {
    residuo_ap: r2(residuo_ap), spettanza: r2(sp), maturato: r2(maturato), goduto: r2(goduto), pianificato: r2(pianificato), in_attesa: r2(in_attesa),
    residuo, disponibile: r2(residuo - Number(in_attesa)), da_pianificare: r2(residuo - Number(in_attesa)), pianificato_totale: r2(Number(goduto) + Number(pianificato)),
    ap_da_pianificare: apDaSmaltire, ap_non_goduto: apNonGoduto,
  };
}

/**
 * Avvisi sul saldo:
 * - AP_SCADENZA: residuo dell'anno precedente non ancora goduto alla scadenza (predefinita 30 giugno, impostazione) o in arrivo;
 * - RISCHIO: nei mesi di controllo (predefiniti ottobre e novembre) restano almeno `soglia` giorni non pianificati;
 * - NEGATIVO: il disponibile è sotto zero (anticipo di ferie da autorizzare).
 */
export function avvisiSaldo(s, { anno, oggi, scadenzaAp = '06-30', mesiRischio = [10, 11], sogliaRischio = 10 } = {}) {
  const out = [];
  const scad = `${anno}-${scadenzaAp}`;
  if (s.ap_non_goduto > 0 && oggi && Number(oggi.slice(0, 4)) === anno) {
    if (oggi > scad) out.push({ tipo: 'AP_SCADENZA', grave: true, giorni: s.ap_non_goduto, testo: `${fmt(s.ap_non_goduto)} giorni dell'anno precedente non goduti entro il ${scad.slice(8, 10)}/${scad.slice(5, 7)}` });
    else if (s.ap_da_pianificare > 0) out.push({ tipo: 'AP_SCADENZA', grave: false, giorni: s.ap_da_pianificare, testo: `${fmt(s.ap_da_pianificare)} giorni dell'anno precedente da pianificare entro il ${scad.slice(8, 10)}/${scad.slice(5, 7)}` });
  }
  const mese = oggi ? Number(oggi.slice(5, 7)) : null;
  if (oggi && Number(oggi.slice(0, 4)) === anno && mesiRischio.includes(mese) && s.disponibile >= sogliaRischio) {
    out.push({ tipo: 'RISCHIO', grave: false, giorni: s.disponibile, testo: `${fmt(s.disponibile)} giorni ancora da pianificare entro fine anno` });
  }
  if (s.disponibile < 0) out.push({ tipo: 'NEGATIVO', grave: true, giorni: s.disponibile, testo: `Saldo negativo: ${fmt(s.disponibile)} giorni` });
  return out;
}

export const fmt = (n) => Number(n || 0).toLocaleString('it-IT', { maximumFractionDigits: 2 });
