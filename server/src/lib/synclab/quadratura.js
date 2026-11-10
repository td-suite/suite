// Quadratura della produzione con il report "Riepilogo Esami" di StudioLab (v0.68.6, CEO 10/11/2026: "C'è una discrepanza tra il valore
// dell'accettato di StudioLab a ieri e quello del Cockpit o comunque della Suite. Trovare l'errore e correggere.").
// Strumento permanente in Amministrazione > Connettori > StudioLAB > Dati Synclab > Quadratura:
//   1. lettura del report (testo di pdftotext o incollato): periodo "Dal gg/mm/aaaa al gg/mm/aaaa", blocchi per cliente (intestazione con
//      il nome, a volte con il reparto "… - Medicina"; una riga per codice esame con Q.ta e importo, anche senza importo per le componenti di
//      profilo; sottototale del cliente) e "Totale globale:" (Q.ta, Privati, Ticket, ULSS, Costo). Nessun nome di paziente: il report non ne
//      contiene e nessun file viene conservato (il testo resta in memoria per la sola richiesta);
//   2. confronto con la Suite (lib/synclab/letture.js `quadratura`) nelle 4 varianti (stati accettato/erogati × sconto di testata sì/no);
//   3. tabella per cliente: nome del report ↔ client Synclab per nome normalizzato (suffisso di reparto " - …" tollerato, nomi troncati a
//      ~45 caratteri), più sottototali dello stesso cliente sommati o abbinati ai client per reparto se esistono; causa calcolata di ogni
//      differenza (stati esclusi, righe cancellate, righe senza prezzo, sconto di testata, client non trovato, accettazioni arrivate dopo
//      l'ultima copia, differenza residua non spiegata).
// Funzioni pure (testate in server/test/v0686-produzione-accettata.test.mjs), tranne xlsxQuadratura (ExcelJS).
import ExcelJS from 'exceljs';
import { calcolaVariante, varianteQuadratura, VARIANTI_QUADRATURA, LEGENDA_STATI } from './letture.js';

const r2 = (n) => (n == null || Number.isNaN(Number(n)) ? null : Math.round((Number(n) + Number.EPSILON) * 100) / 100);
export const TOLLERANZA_EUR = 0.05;   // differenze fino a 5 centesimi = arrotondamenti
const NUM_INT = /^(?:\d{1,3}(?:\.\d{3})+|\d+)$/;
const NUM_DEC = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{1,4}$/;
const numIt = (t) => Number(String(t).replace(/\./g, '').replace(',', '.'));
const dataIso = (g) => { const m = String(g).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const itData = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

/** Coda numerica di una riga: { testo, qta, importi } (qta = ultimo intero seguito solo da importi con la virgola). */
export function codaNumerica(riga) {
  const tok = String(riga).replace(/€/g, ' ').trim().split(/\s+/).filter(Boolean);
  let i = tok.length;
  while (i > 0 && (NUM_INT.test(tok[i - 1]) || NUM_DEC.test(tok[i - 1]))) i--;
  const run = tok.slice(i);
  let q = -1;
  for (let k = run.length - 1; k >= 0; k--) { if (NUM_INT.test(run[k])) { q = k; break; } if (!NUM_DEC.test(run[k])) break; }
  if (q < 0) {
    // solo importi (nessuna quantità): la riga ha numeri ma non una Q.ta
    return { testo: tok.slice(0, i).join(' '), qta: null, importi: run.filter((t) => NUM_DEC.test(t)).map(numIt), numeri: run.length };
  }
  return { testo: [...tok.slice(0, i), ...run.slice(0, q)].join(' '), qta: numIt(run[q]), importi: run.slice(q + 1).map(numIt), numeri: run.length - q };
}

/** Nome cliente normalizzato: minuscolo, senza accenti, punteggiatura e forme societarie (S.r.l., S.p.A., …). */
export function normCliente(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' e ').replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ').replace(/\b(srl|srls|spa|sas|snc|scarl|scrl|sapa|onlus|soc|societa|unipersonale)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Nome del report diviso in base e reparto (ultimo " - "): "Casa di Cura X S.r.l. - Medicina" → { base, reparto: 'Medicina' }. */
export function dividiReparto(nome) {
  const s = String(nome || '').trim();
  const i = s.lastIndexOf(' - ');
  if (i <= 0 || i >= s.length - 3) return { base: s, reparto: null };
  return { base: s.slice(0, i).trim(), reparto: s.slice(i + 3).trim() || null };
}

// primo token di una riga d'esame: codice con almeno una cifra (25990, GLU1) o sigla maiuscola corta (IND, GLU)
const CODICE_ESAME = /^(?=[A-Z0-9._-]*\d)[A-Z0-9][A-Z0-9._-]{0,11}$|^[A-Z]{2,6}$/;
// Layout reale del report (pdftotext -layout del PDF di StudioLab, verificato il 10/11/2026):
//   - a ogni pagina: intestazione con la ragione sociale del laboratorio, "Riepilogo Esami … Dal gg/mm/aaaa al gg/mm/aaaa", riga delle
//     colonne "Codice Descrizione Q.ta Privati Ticket ULSS Costo", in fondo "Pagina n di m": tutto ignorato, ovunque; un blocco che
//     continua dopo il salto pagina resta lo stesso cliente;
//   - riga cliente: testo a margine sinistro senza colonne numeriche (con il reparto "… - Medicina");
//   - riga d'esame: codice + descrizione + Q.ta + eventuale Privati + eventuale Costo (righe con sola Q.ta, righe con Q.ta e solo Costo):
//     ogni numero va nella colonna dell'intestazione più vicina per POSIZIONE, non per ordine;
//   - riga di sottototale: solo numeri, molto rientrata (Q.ta, Privati, Ticket, ULSS, Costo): è la fonte autorevole del cliente, le righe
//     d'esame servono solo come controllo; si accetta anche la forma "Totale cliente: …" / "Totale <nome>: …";
//   - ultima riga "Totale globale: Q.ta Privati Ticket ULSS Costo".
const RE_PERIODO = /\bdal\s+(\d{2}\/\d{2}\/\d{4})\s+al\s+(\d{2}\/\d{2}\/\d{4})/i;
const RE_PAGINA = /^pag(ina|\.)?\s*\d+(\s*(di|\/)\s*\d+)?$/i;
const RE_COLONNE = /\bq\.?\s?t[aà]\b/i;
const RIGA_IGNORATA = /^(pag(ina|\.)?\s*\d+(\s*(di|\/)\s*\d+)?\s*$|stampato\b|data\s+stampa|riepilogo\s+esami)/i;
const COLONNE = ['qta', 'privati', 'ticket', 'ulss', 'costo'];
const DISTANZA_MAX = 12;   // un numero più lontano di così da ogni colonna fa parte della descrizione

/** Posizioni (colonna di fine) delle intestazioni Q.ta, Privati, Ticket, ULSS, Costo; null se la riga non è l'intestazione delle colonne. */
export function colonneIntestazione(riga) {
  const s = String(riga);
  if (!RE_COLONNE.test(s)) return null;
  const out = {};
  for (const [k, re] of [['qta', /q\.?\s?t[aà]/i], ['privati', /privati/i], ['ticket', /ticket/i], ['ulss', /ulss/i], ['costo', /costo/i]]) {
    const m = re.exec(s); if (m) out[k] = m.index + m[0].length;
  }
  return out.qta != null && (out.privati != null || out.costo != null) ? out : null;
}
const tokenConPosizione = (s) => { const out = []; const re = /\S+/g; let m; while ((m = re.exec(s))) out.push({ t: m[0], s: m.index, e: m.index + m[0].length }); return out; };
/**
 * Riga con le colonne numeriche: { testo, qta, privati, ticket, ulss, costo, numeri }. Con le posizioni delle colonne (col) ogni numero va
 * nella colonna più vicina per posizione; senza (testo incollato senza intestazione) per ordine: Q.ta, Privati, Ticket, ULSS, Costo.
 */
export function analizzaRiga(riga, col = null) {
  const s = String(riga).replace(/€/g, ' ').replace(/\s+$/, '');
  const tok = tokenConPosizione(s);
  const out = { testo: '', qta: null, privati: null, ticket: null, ulss: null, costo: null, numeri: 0 };
  if (!col) {
    const c = codaNumerica(s);
    return { ...out, testo: c.testo, qta: c.qta, privati: c.importi[0] ?? null, ticket: c.importi[1] ?? null, ulss: c.importi[2] ?? null, costo: c.importi[3] ?? null, numeri: c.numeri };
  }
  let i = tok.length;
  while (i > 0) {
    const x = tok[i - 1];
    const intero = NUM_INT.test(x.t), dec = NUM_DEC.test(x.t);
    if (!intero && !dec) break;
    let best = null;
    for (const k of COLONNE) if (col[k] != null) { const d = Math.abs(x.e - col[k]); if (!best || d < best.d) best = { k, d }; }
    if (!best || best.d > DISTANZA_MAX || out[best.k] != null) break;
    if (best.k === 'qta' && !intero) break;
    if (best.k !== 'qta' && !dec) break;
    out[best.k] = numIt(x.t); out.numeri += 1; i -= 1;
  }
  out.testo = i ? s.slice(0, tok[i - 1].e).trim() : '';
  return out;
}

/**
 * Lettura del testo del report "Riepilogo Esami" (pdftotext -layout o testo incollato). Ritorna { periodo: { da, a }, clienti: [{ nome,
 * base, reparto, qta, importo, costo, righe, righe_senza_importo, qta_righe, importo_righe, sottototale }], totale: { qta, importo, ticket,
 * ulss, costo }, controllo: { somma_qta, somma_importo, coincide }, avvisi }. Le righe d'esame non sono conservate (solo i conteggi).
 */
export function leggiRiepilogoEsami(testo) {
  const out = { periodo: { da: null, a: null }, clienti: [], totale: null, avvisi: [] };
  const righe = String(testo || '').replace(/\r\n?/g, '\n').replace(/\f/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const mp = String(testo || '').match(RE_PERIODO);
  if (mp) out.periodo = { da: dataIso(mp[1]), a: dataIso(mp[2]) };
  // intestazione di pagina: la riga di testo (senza numeri) che precede "Riepilogo Esami … Dal … al …"; ignorata ovunque compaia
  const ignora = new Set();
  const intestazioni = new Set();
  righe.forEach((l, i) => {
    if (!RE_PERIODO.test(l)) return;
    for (let j = i - 1; j >= 0; j--) {
      const t = righe[j].trim();
      if (!t) continue;
      if (!/\d/.test(t) && !RE_COLONNE.test(t)) { ignora.add(j); intestazioni.add(normCliente(t)); }
      break;
    }
  });
  let col = null;            // posizioni delle colonne dell'ultima intestazione letta (cambiano un poco da pagina a pagina)
  let cur = null;            // blocco del cliente in corso
  let ultimaIntestazione = false;
  const nuovo = (nome) => { cur = { nome: nome.trim(), qta: null, importo: null, ticket: null, ulss: null, costo: null, righe: 0, righe_senza_importo: 0, qta_righe: 0, importo_righe: 0, sottototale: false }; out.clienti.push(cur); return cur; };
  const chiudiCon = (b, x) => { b.qta = x.qta; b.importo = x.privati ?? (x.qta != null ? 0 : null); b.ticket = x.ticket; b.ulss = x.ulss; b.costo = x.costo; b.sottototale = true; cur = null; };
  righe.forEach((l, i) => {
    const t = l.trim();
    if (!t) { ultimaIntestazione = false; return; }
    if (ignora.has(i) || intestazioni.has(normCliente(t))) return;
    const c0 = colonneIntestazione(l);
    if (c0) { col = c0; ultimaIntestazione = false; return; }
    if (/totale\s+globale/i.test(t)) {
      const k = l.search(/totale\s+globale\s*:?/i); const pre = l.slice(0, k).replace(/./g, ' ') + l.slice(k).replace(/totale\s+globale\s*:?/i, (m) => ' '.repeat(m.length));
      const x = analizzaRiga(pre, col);
      out.totale = { qta: x.qta, importo: x.privati, ticket: x.ticket, ulss: x.ulss, costo: x.costo };
      cur = null; ultimaIntestazione = false; return;
    }
    if (RE_PERIODO.test(t) || RIGA_IGNORATA.test(t) || RE_PAGINA.test(t)) { ultimaIntestazione = false; return; }
    const x = analizzaRiga(l, col);
    if (/^total[ei]\b/i.test(t)) {
      // sottototale nella forma "Totale [cliente] [nome]: Q.ta importi"
      const nome = x.testo.replace(/^total[ei]\s*(cliente|reparto)?\s*:?\s*/i, '').replace(/:\s*$/, '').trim();
      let b = cur && !cur.sottototale ? cur : null;
      if (!b) b = nuovo(nome || 'Cliente senza nome');
      else if (nome && b.anonimo) { b.nome = nome; b.anonimo = false; }
      chiudiCon(b, x); ultimaIntestazione = false; return;
    }
    if (!x.numeri) {
      // riga cliente (eventualmente su due righe)
      if (ultimaIntestazione && cur && !cur.righe) cur.nome = `${cur.nome} ${t}`.replace(/\s+/g, ' ');
      else nuovo(t);
      ultimaIntestazione = true; return;
    }
    ultimaIntestazione = false;
    if (!x.testo) {
      // sottototale: solo numeri, fonte autorevole del cliente in corso
      if (cur && !cur.sottototale) chiudiCon(cur, x);
      else { out.avvisi.push(`Riga di soli numeri fuori da un cliente (Q.ta ${x.qta ?? '–'}): ignorata`); }
      return;
    }
    if (cur && !cur.sottototale && cur.righe > 0 && normCliente(x.testo) && (normCliente(x.testo) === normCliente(cur.nome) || normCliente(cur.nome).startsWith(normCliente(x.testo)))) {
      chiudiCon(cur, x); return;   // sottototale scritto con il solo nome del cliente
    }
    if (!cur || cur.sottototale) {
      if (CODICE_ESAME.test(x.testo.split(' ')[0] || '') && x.testo.includes(' ')) { nuovo(''); cur.anonimo = true; }
      else { const b = nuovo(x.testo || 'Cliente senza nome'); chiudiCon(b, x); return; }   // cliente con i totali sulla stessa riga
    }
    // riga d'esame (anche senza importo: componenti di profilo; con Q.ta e solo Costo)
    cur.righe += 1; cur.qta_righe += Number(x.qta || 0);
    if (x.privati != null) cur.importo_righe = r2(cur.importo_righe + x.privati); else cur.righe_senza_importo += 1;
  });
  for (const b of out.clienti) {
    if (!b.sottototale) { b.qta = b.qta_righe; b.importo = r2(b.importo_righe); if (b.righe) out.avvisi.push(`${b.nome || 'Cliente senza nome'}: sottototale non trovato, usate le righe d'esame`); }
    else if (b.righe && (b.qta_righe !== b.qta || Math.abs(Number(b.importo_righe) - Number(b.importo || 0)) > TOLLERANZA_EUR)) out.avvisi.push(`${b.nome}: le righe d'esame (${b.qta_righe}, ${b.importo_righe}) non coincidono con il sottototale (${b.qta}, ${b.importo})`);
    if (!b.nome) b.nome = 'Cliente senza nome';
    delete b.anonimo;
    Object.assign(b, dividiReparto(b.nome));
  }
  out.clienti = out.clienti.filter((b) => b.righe || b.sottototale);
  const somma_qta = out.clienti.reduce((s, b) => s + Number(b.qta || 0), 0);
  const somma_importo = r2(out.clienti.reduce((s, b) => s + Number(b.importo || 0), 0));
  out.controllo = { sottototali: out.clienti.length, somma_qta, somma_importo, coincide: out.totale ? (out.totale.qta == null || out.totale.qta === somma_qta) && Math.abs(Number(out.totale.importo || 0) - somma_importo) <= TOLLERANZA_EUR : null };
  if (!out.periodo.da) out.avvisi.push('Periodo non trovato ("Dal gg/mm/aaaa al gg/mm/aaaa"): indicarlo a mano');
  if (!out.totale) out.avvisi.push('"Totale globale:" non trovato');
  else if (out.clienti.length && out.controllo.coincide === false) out.avvisi.push(`La somma dei sottototali (${somma_qta} esami, ${somma_importo}) non coincide con il totale globale (${out.totale.qta} esami, ${out.totale.importo})`);
  if (!out.clienti.length) out.avvisi.push('Nessun sottototale per cliente letto: confronto solo sul totale');
  return out;
}

/** Report inserito a mano (periodo e totali, senza clienti). */
export function reportManuale({ da, a, qta = null, importo }) {
  return { periodo: { da, a }, clienti: [], totale: { qta: qta == null || qta === '' ? null : Number(qta), importo: importo == null || importo === '' ? null : Number(importo), ticket: null, ulss: null, costo: null },
    controllo: { somma_qta: 0, somma_importo: 0, coincide: null }, avvisi: ['Totali inseriti a mano: confronto solo sul totale'], manuale: true };
}

/** Candidati del report fra i client Synclab (nome normalizzato, reparto, nomi troncati). clients: [{ chiave, legal_name, sede_gestionale, cliente, client_code }] */
export function candidatiReport(blocco, clients, { troncamento = 40 } = {}) {
  const full = normCliente(blocco.nome), base = normCliente(blocco.base || blocco.nome), rep = blocco.reparto ? normCliente(blocco.reparto) : null;
  const chiavi = (c) => [normCliente(c.legal_name), normCliente(`${c.legal_name || ''} ${c.sede_gestionale || ''}`), normCliente(c.cliente)].filter(Boolean);
  const troncato = String(blocco.nome || '').trim().length >= troncamento || String(blocco.base || '').trim().length >= troncamento;
  let regola = 'NOME';
  let cand = clients.filter((c) => chiavi(c).includes(full));
  if (!cand.length && base !== full) { cand = clients.filter((c) => chiavi(c).includes(base)); regola = 'NOME_SENZA_REPARTO'; }
  if (!cand.length && troncato) { cand = clients.filter((c) => chiavi(c).some((k) => (full && k.startsWith(full)) || (base && k.startsWith(base)))); regola = 'NOME_TRONCATO'; }
  if (cand.length > 1 && rep) {
    const perRep = cand.filter((c) => normCliente(c.sede_gestionale).includes(rep) || normCliente(c.legal_name).includes(rep) || normCliente(c.client_code) === rep);
    if (perRep.length) { cand = perRep; regola = `${regola}+REPARTO`; }
  }
  return { candidati: cand, regola: cand.length ? regola : null };
}

/**
 * Sceglie le cause che spiegano una differenza (report − Suite): sottoinsieme delle cause quantificate la cui somma è più vicina alla
 * differenza (a parità, meno cause). cause: [{ codice, effetto }] (effetto = di quanto cambierebbe la Suite verso il report).
 */
export function scegliCause(diff, cause, toll = TOLLERANZA_EUR) {
  const q = cause.filter((c) => c.effetto != null && Math.abs(Number(c.effetto)) > 0);
  let best = { set: [], somma: 0, resto: diff };
  const n = Math.min(q.length, 8);
  for (let m = 1; m < (1 << n); m++) {
    let somma = 0; const set = [];
    for (let k = 0; k < n; k++) if (m & (1 << k)) { somma += Number(q[k].effetto); set.push(q[k].codice); }
    const resto = diff - somma;
    if (Math.abs(resto) < Math.abs(best.resto) - 1e-9 || (Math.abs(Math.abs(resto) - Math.abs(best.resto)) <= 1e-9 && set.length < best.set.length)) best = { set, somma, resto };
  }
  // nessuna causa se non migliora la differenza
  if (Math.abs(best.resto) >= Math.abs(diff) - 1e-9) best = { set: [], somma: 0, resto: diff };
  return { codici: best.set, spiegato: r2(best.somma), residuo: r2(best.resto), quadra: Math.abs(best.resto) <= toll };
}

/**
 * Confronto del report con i dati della Suite (risultato di letture.quadratura). variante: chiave (predefinita: la prima che coincide sul
 * totale, altrimenti quella in vigore). Ritorna { periodo, report, varianti: [{ ..., differenza, coincide, migliore }], variante, righe, totale,
 * copia, note }.
 */
export function confrontaQuadratura(report, base, { variante = null } = {}) {
  const tot = report?.totale || {};
  const fineOk = (x) => (x == null ? null : r2(x));
  const varianti = base.varianti.map((v) => {
    const d = tot.importo == null ? null : r2(Number(tot.importo) - Number(v.totale.importo));
    const dq = tot.qta == null ? null : Number(tot.qta) - Number(v.totale.quantita);
    return { chiave: v.chiave, etichetta: v.etichetta, stati: v.stati, sconto: v.sconto, in_vigore: v.in_vigore, importo: v.totale.importo, quantita: v.totale.quantita, righe: v.totale.righe,
      accettazioni: v.totale.accettazioni, righe_senza_prezzo: v.totale.righe_senza_prezzo, differenza: d, differenza_qta: dq, coincide: d != null && Math.abs(d) <= TOLLERANZA_EUR, coincide_qta: dq === 0 };
  });
  const conD = varianti.filter((v) => v.differenza != null);
  const migliore = conD.length ? conD.reduce((b, v) => (Math.abs(v.differenza) < Math.abs(b.differenza) ? v : b)) : null;
  for (const v of varianti) v.migliore = Boolean(migliore && v.chiave === migliore.chiave);
  const scelta = variante ? (varianti.find((v) => v.chiave === variante) || varianti[0]) : (varianti.find((v) => v.coincide) || varianti.find((v) => v.in_vigore) || varianti[0]);
  const vq = varianteQuadratura(VARIANTI_QUADRATURA.some((x) => x.chiave === scelta.chiave) ? scelta.chiave : { stati: scelta.stati, sconto: scelta.sconto });
  const applica = vq.sconto === 'APPLICA';
  const clients = base.clienti.map((c) => ({ ...c, chiave: `${c.instance_id}|${c.client_id}`, calcolo: calcolaVariante(c.righe, vq) }));
  // 1. candidati per blocco del report; 2. componenti connesse (blocchi ↔ client): più sottototali dello stesso client si sommano
  const blocchi = (report?.clienti || []).map((b, i) => ({ ...b, i, ...candidatiReport(b, clients) }));
  const padre = new Map();
  const trova = (x) => { while (padre.get(x) !== x) { padre.set(x, padre.get(padre.get(x))); x = padre.get(x); } return x; };
  const unisci = (a, b) => { const ra = trova(a), rb = trova(b); if (ra !== rb) padre.set(ra, rb); };
  for (const b of blocchi) { padre.set(`b${b.i}`, `b${b.i}`); for (const c of b.candidati) { if (!padre.has(`c${c.chiave}`)) padre.set(`c${c.chiave}`, `c${c.chiave}`); unisci(`b${b.i}`, `c${c.chiave}`); } }
  const gruppi = new Map();
  for (const b of blocchi) { const r = trova(`b${b.i}`); if (!gruppi.has(r)) gruppi.set(r, { blocchi: [], clients: new Map() }); const g = gruppi.get(r); g.blocchi.push(b); for (const c of b.candidati) g.clients.set(c.chiave, c); }
  const fine = base.periodo.a;
  const cp = base.copia?.checkpoint_at || null;
  const cpGiorno = cp ? new Date(cp).toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' }) : null;
  const copiaPrima = !cp || cpGiorno <= fine;   // la copia non copre interamente l'ultimo giorno del periodo
  const cpTesto = cp ? new Date(cp).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '') : null;
  const sommaCalc = (lista) => {
    const t = { accettazioni: 0, righe: 0, quantita: 0, importo: 0, righe_senza_prezzo: 0, sconto_testata: 0, esclusi: { accettazioni: 0, righe: 0, quantita: 0, importo: 0 }, cancellate: { righe: 0, quantita: 0, importo: 0 }, stati_esclusi: new Map() };
    for (const c of lista) {
      const k = c.calcolo;
      t.accettazioni += k.accettazioni; t.righe += k.righe; t.quantita += k.quantita; t.importo += k.importo; t.righe_senza_prezzo += k.righe_senza_prezzo; t.sconto_testata += k.sconto_testata;
      for (const f of ['accettazioni', 'righe', 'quantita', 'importo']) t.esclusi[f] += Number(k.esclusi[f] || 0);
      for (const f of ['righe', 'quantita', 'importo']) t.cancellate[f] += Number(k.cancellate[f] || 0);
      for (const s of k.stati_esclusi) { const p = t.stati_esclusi.get(s.stato) || { ...s, accettazioni: 0, righe: 0, quantita: 0, importo: 0 }; p.accettazioni += s.accettazioni; p.righe += s.righe; p.quantita += s.quantita; p.importo += s.importo; t.stati_esclusi.set(s.stato, p); }
    }
    t.importo = r2(t.importo); t.sconto_testata = r2(t.sconto_testata); t.esclusi.importo = r2(t.esclusi.importo); t.cancellate.importo = r2(t.cancellate.importo);
    t.stati_esclusi = [...t.stati_esclusi.values()].map((x) => ({ ...x, importo: r2(x.importo) }));
    return t;
  };
  const causeDi = (s, diff, dq) => {
    const descrStati = s.stati_esclusi.filter((x) => x.accettazioni).map((x) => `${x.stato ?? 'n.d.'} ${x.etichetta}: ${x.accettazioni}`).join(', ');
    const cause = [
      { codice: 'STATI_ESCLUSI', testo: `Accettazioni in stati esclusi dalla variante (${descrStati || 'nessuna'})`, n: s.esclusi.accettazioni, effetto: s.esclusi.importo, effetto_qta: s.esclusi.quantita },
      { codice: 'RIGHE_CANCELLATE', testo: 'Righe d\'esame cancellate (deleted) nella copia', n: s.cancellate.righe, effetto: s.cancellate.importo, effetto_qta: s.cancellate.quantita },
      { codice: 'SCONTO_TESTATA', testo: applica ? 'Sconto di testata applicato dalla Suite (il report somma gli importi di riga)' : 'Sconto di testata non applicato dalla Suite (se il report fosse al netto)', n: null, effetto: s.sconto_testata ? (applica ? s.sconto_testata : -s.sconto_testata) : 0, effetto_qta: 0 },
    ];
    const sc = diff == null ? { codici: [], residuo: null, quadra: null, spiegato: 0 } : scegliCause(diff, cause.map((c) => ({ codice: c.codice, effetto: c.effetto })));
    const scq = dq == null ? { codici: [], residuo: null, quadra: null } : scegliCause(dq, cause.map((c) => ({ codice: c.codice, effetto: c.effetto_qta })), 0.5);
    const out = cause.filter((c) => (c.n || Math.abs(Number(c.effetto || 0)) > 0 || c.effetto_qta)).map((c) => ({ ...c, spiega: sc.codici.includes(c.codice), spiega_qta: scq.codici.includes(c.codice) }));
    if (s.righe_senza_prezzo) out.push({ codice: 'RIGHE_SENZA_PREZZO', testo: 'Righe senza prezzo: contano nella Q.ta (come nel report), non nell\'importo', n: s.righe_senza_prezzo, effetto: null, effetto_qta: null, spiega: false, spiega_qta: false });
    if (sc.residuo != null && sc.residuo > TOLLERANZA_EUR && copiaPrima) out.push({ codice: 'DOPO_COPIA', testo: `Possibili accettazioni del periodo arrivate dopo l'ultima copia${cpTesto ? ` (${cpTesto})` : ''}: rilanciare la sincronizzazione e ripetere`, n: null, effetto: null, effetto_qta: null, spiega: false, spiega_qta: false });
    if (sc.residuo != null && Math.abs(sc.residuo) > TOLLERANZA_EUR) out.push({ codice: 'RESIDUO', testo: 'Differenza residua non spiegata', n: null, effetto: sc.residuo, effetto_qta: scq.residuo, spiega: false, spiega_qta: false });
    return { cause: out, residuo: sc.residuo, residuo_qta: scq.residuo, quadra: sc.quadra, quadra_qta: scq.quadra };
  };
  const righe = [];
  for (const g of gruppi.values()) {
    const rq = g.blocchi.reduce((t, b) => t + Number(b.qta || 0), 0), ri = r2(g.blocchi.reduce((t, b) => t + Number(b.importo || 0), 0));
    const lista = [...g.clients.values()];
    if (!lista.length) {
      righe.push({ esito: 'SOLO_REPORT', report: { nomi: g.blocchi.map((b) => b.nome), qta: rq, importo: ri }, suite: null, clienti: [], differenza: { importo: ri, qta: rq },
        cause: [{ codice: 'CLIENT_NON_TROVATO', testo: 'Client non trovato fra i client Synclab della copia (nome diverso o client non importato): abbinarlo o verificarlo nel gestionale', n: null, effetto: ri, effetto_qta: rq, spiega: true, spiega_qta: true }], residuo: 0, residuo_qta: 0 });
      continue;
    }
    const s = sommaCalc(lista);
    const diff = r2(ri - s.importo), dq = rq - s.quantita;
    const c = causeDi(s, diff, dq);
    const esito = Math.abs(diff) <= TOLLERANZA_EUR && dq === 0 ? 'QUADRA' : c.quadra ? 'SPIEGATA' : 'NON_SPIEGATA';
    righe.push({ esito, regola: [...new Set(g.blocchi.map((b) => b.regola))].join(', '), report: { nomi: g.blocchi.map((b) => b.nome), qta: rq, importo: ri },
      clienti: lista.map((x) => ({ client_id: x.client_id, client_code: x.client_code, legal_name: x.legal_name, sede_gestionale: x.sede_gestionale, ripartizione: x.ripartizione, cliente: x.cliente })),
      suite: { accettazioni: s.accettazioni, righe: s.righe, quantita: s.quantita, importo: s.importo, righe_senza_prezzo: s.righe_senza_prezzo, sconto_testata: s.sconto_testata, stati_esclusi: s.stati_esclusi },
      differenza: { importo: diff, qta: dq }, cause: c.cause, residuo: c.residuo, residuo_qta: c.residuo_qta });
  }
  // client della Suite con produzione nella variante e non nel report
  const presi = new Set([...gruppi.values()].flatMap((g) => [...g.clients.keys()]));
  for (const c of clients.filter((x) => !presi.has(x.chiave) && (x.calcolo.righe || x.calcolo.importo))) {
    const s = sommaCalc([c]);
    righe.push({ esito: 'SOLO_SUITE', report: null, clienti: [{ client_id: c.client_id, client_code: c.client_code, legal_name: c.legal_name, sede_gestionale: c.sede_gestionale, ripartizione: c.ripartizione, cliente: c.cliente }],
      suite: { accettazioni: s.accettazioni, righe: s.righe, quantita: s.quantita, importo: s.importo, righe_senza_prezzo: s.righe_senza_prezzo, sconto_testata: s.sconto_testata, stati_esclusi: s.stati_esclusi },
      differenza: { importo: r2(-s.importo), qta: -s.quantita },
      cause: [{ codice: 'NON_NEL_REPORT', testo: report?.clienti?.length ? 'Client con produzione nella Suite ma assente dal report (nome diverso nel report o report filtrato)' : 'Report senza sottototali per cliente', n: null, effetto: r2(-s.importo), effetto_qta: -s.quantita, spiega: Boolean(report?.clienti?.length), spiega_qta: Boolean(report?.clienti?.length) }], residuo: 0, residuo_qta: 0 });
  }
  const ordine = { NON_SPIEGATA: 0, SOLO_REPORT: 1, SOLO_SUITE: 2, SPIEGATA: 3, QUADRA: 4 };
  righe.sort((a, b) => (ordine[a.esito] - ordine[b.esito]) || (Math.abs(Number(b.differenza.importo || 0)) - Math.abs(Number(a.differenza.importo || 0))));
  // totale della variante scelta con le cause sul totale
  const sTot = sommaCalc(clients);
  const dTot = tot.importo == null ? null : r2(Number(tot.importo) - sTot.importo);
  const dqTot = tot.qta == null ? null : Number(tot.qta) - sTot.quantita;
  const cTot = causeDi(sTot, dTot, dqTot);
  const conteggi = Object.fromEntries(Object.keys(ordine).map((k) => [k, righe.filter((r) => r.esito === k).length]));
  return {
    periodo: base.periodo, report: { periodo: report?.periodo || null, totale: tot, clienti: (report?.clienti || []).length, controllo: report?.controllo || null, avvisi: report?.avvisi || [], manuale: Boolean(report?.manuale) },
    varianti, variante: { chiave: scelta.chiave, etichetta: scelta.etichetta, stati: vq.stati, sconto: vq.sconto, in_vigore: scelta.in_vigore },
    totale: { report: { qta: tot.qta ?? null, importo: fineOk(tot.importo) }, suite: { accettazioni: sTot.accettazioni, righe: sTot.righe, quantita: sTot.quantita, importo: sTot.importo, righe_senza_prezzo: sTot.righe_senza_prezzo, sconto_testata: sTot.sconto_testata, stati_esclusi: sTot.stati_esclusi },
      differenza: { importo: dTot, qta: dqTot }, cause: cTot.cause, residuo: cTot.residuo },
    righe, conteggi, copia: base.copia, copia_prima_della_fine: copiaPrima, in_vigore: base.in_vigore,
    note: [`Periodo ${itData(base.periodo.da)} - ${itData(base.periodo.a)}, data dell'accettazione; tutti i client Synclab (B2B e Laboratorio in sede)`, base.regola,
      `Tolleranza ${TOLLERANZA_EUR.toLocaleString('it-IT')} € per gli arrotondamenti`, `Legenda degli stati: ${Object.entries(LEGENDA_STATI).map(([k, v]) => `${k} ${v}`).join(', ')}`],
  };
}

const ESITI = { QUADRA: 'quadra', SPIEGATA: 'differenza spiegata', NON_SPIEGATA: 'differenza non spiegata', SOLO_REPORT: 'solo nel report', SOLO_SUITE: 'solo nella Suite' };
export const ETICHETTE_ESITO = ESITI;

/** XLSX della quadratura (fogli Varianti, Per cliente, Cause sul totale, Note). Nessun dato di pazienti. */
export async function xlsxQuadratura(q) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Suite TD'; wb.created = new Date();
  const eur = '#,##0.00';
  const v = wb.addWorksheet('Varianti');
  v.addRow([`Quadratura con il report "Riepilogo Esami" di StudioLab · dal ${itData(q.periodo.da)} al ${itData(q.periodo.a)}`]).font = { bold: true };
  v.addRow([]);
  v.addRow(['Variante', 'Stati', 'Sconto di testata', 'In vigore', 'Esami (Q.ta) Suite', 'Importo Suite', 'Q.ta report', 'Importo report', 'Differenza importo', 'Differenza Q.ta', 'Coincide']).font = { bold: true };
  for (const x of q.varianti) v.addRow([x.etichetta, x.stati.join(', '), x.sconto === 'APPLICA' ? 'applicato' : 'non applicato', x.in_vigore ? 'sì' : '', x.quantita, x.importo, q.totale.report.qta, q.totale.report.importo, x.differenza, x.differenza_qta, x.coincide ? 'sì' : (x.migliore ? 'più vicina' : '')]);
  [6, 8, 9].forEach((c) => { v.getColumn(c).numFmt = eur; });
  v.columns.forEach((c, i) => { c.width = i === 0 ? 44 : 16; });
  const p = wb.addWorksheet('Per cliente');
  p.addRow([`Variante: ${q.variante.etichetta} (stati ${q.variante.stati.join(', ')}, sconto di testata ${q.variante.sconto === 'APPLICA' ? 'applicato' : 'non applicato'})`]).font = { bold: true };
  p.addRow(['Esito', 'Nome nel report', 'Client Synclab', 'Ripartizione', 'Q.ta report', 'Importo report', 'Q.ta Suite', 'Importo Suite', 'Differenza Q.ta', 'Differenza importo', 'Senza prezzo', 'Sconto di testata', 'Cause', 'Residuo']).font = { bold: true };
  for (const r of q.righe) {
    p.addRow([ESITI[r.esito] || r.esito, (r.report?.nomi || []).join(' + '), r.clienti.map((c) => `${c.client_code || c.client_id} ${c.legal_name || ''}`.trim()).join(' + '), [...new Set(r.clienti.map((c) => c.ripartizione === 'LAB_SEDE' ? 'Laboratorio in sede' : 'B2B'))].join(', '),
      r.report?.qta ?? null, r.report?.importo ?? null, r.suite?.quantita ?? null, r.suite?.importo ?? null, r.differenza.qta, r.differenza.importo, r.suite?.righe_senza_prezzo ?? null, r.suite?.sconto_testata ?? null,
      r.cause.map((c) => `${c.testo}${c.n != null ? ` (n ${c.n})` : ''}${c.effetto != null ? `: ${Number(c.effetto).toLocaleString('it-IT', { minimumFractionDigits: 2 })} €` : ''}${c.spiega ? ' [spiega]' : ''}`).join('; '), r.residuo]);
  }
  [6, 8, 10, 12, 14].forEach((c) => { p.getColumn(c).numFmt = eur; });
  p.columns.forEach((c, i) => { c.width = [22, 44, 44, 18][i] || 14; });
  p.getColumn(13).width = 90;
  const c = wb.addWorksheet('Cause sul totale');
  c.addRow(['Causa', 'Numero', 'Effetto sull\'importo', 'Effetto sulla Q.ta', 'Spiega la differenza']).font = { bold: true };
  for (const x of q.totale.cause) c.addRow([x.testo, x.n, x.effetto, x.effetto_qta, x.spiega ? 'sì' : '']);
  c.getColumn(3).numFmt = eur; c.getColumn(1).width = 90; [2, 3, 4, 5].forEach((k) => { c.getColumn(k).width = 18; });
  const n = wb.addWorksheet('Note');
  for (const t of [...q.note, ...(q.report.avvisi || []).map((a) => `Lettura del report: ${a}`), q.copia?.checkpoint_at ? `Copia delle accettazioni: ${new Date(q.copia.checkpoint_at).toLocaleString('it-IT', { timeZone: 'Europe/Rome' })}` : 'Nessuna copia delle accettazioni']) n.addRow([t]);
  n.getColumn(1).width = 140;
  return wb.xlsx.writeBuffer();
}
