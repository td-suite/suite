// Business Hub · Listino StudioLAB del cliente (richiesta del CEO del 06/11/2026): "In anagrafica del cliente, carico l'excel del listino
// che viene da StudioLab. E versioni successive, se il cliente chiede sconti."
// Regole pure (senza database), usate dalla route, dal generatore dell'offerta economica e dai test (server/test/business-service-flow).
// Il formato esatto dell'export di StudioLAB non è disponibile: l'importatore riconosce le colonne dalle intestazioni con sinonimi
// (codice, descrizione, settore, prezzo di listino, prezzo offerto, sconto, unità, note), trova la riga di intestazione nelle prime
// righe del foglio, accetta numeri all'italiana ("1.234,50 €", "20%") e, se non riconosce le colonne indispensabili, chiede il
// mapping a video, che si salva e vale per i caricamenti successivi. Prima di salvare c'è sempre l'anteprima.
import ExcelJS from 'exceljs';

// Campi del listino: chiave, etichetta, obbligatorio, sinonimi (normalizzati: minuscole, senza accenti e punteggiatura)
export const CAMPI = [
  { k: 'codice', label: 'Codice esame', sinonimi: ['codice esame', 'cod esame', 'codice prestazione', 'cod prestazione', 'codice analisi', 'cod analisi', 'codice', 'cod', 'id esame', 'sigla', 'codice lis', 'cod lis', 'codice interno', 'codice studiolab'] },
  { k: 'descrizione', label: 'Descrizione', obbligatorio: true, sinonimi: ['descrizione esame', 'descrizione prestazione', 'descrizione analisi', 'descrizione', 'esame', 'prestazione', 'analisi', 'denominazione', 'nome esame', 'nome', 'test'] },
  { k: 'settore', label: 'Settore / sezione', sinonimi: ['settore', 'sezione', 'reparto', 'branca', 'disciplina', 'categoria', 'gruppo esami', 'gruppo', 'area', 'specialita'] },
  { k: 'listino', label: 'Prezzo di listino', obbligatorio: true, sinonimi: ['prezzo di listino', 'prezzo listino', 'listino', 'tariffa listino', 'tariffa', 'prezzo pubblico', 'importo listino', 'prezzo base', 'prezzo intero', 'prezzo pieno', 'prezzo unitario', 'prezzo'] },
  { k: 'offerto', label: 'Prezzo offerto / scontato', sinonimi: ['prezzo offerto', 'prezzo scontato', 'prezzo netto', 'prezzo cliente', 'prezzo proposto', 'prezzo applicato', 'prezzo riservato', 'prezzo convenzione', 'prezzo offerta', 'offerta', 'netto', 'scontato', 'importo netto', 'prezzo finale'] },
  { k: 'sconto', label: 'Sconto %', sinonimi: ['sconto percentuale', 'sconto %', '% sconto', 'perc sconto', 'percentuale sconto', 'sconto', 'sc', 'discount'] },
  { k: 'unita', label: 'Unità', sinonimi: ['unita di misura', 'unita', 'um', 'u m', 'quantita', 'qta'] },
  { k: 'note', label: 'Note', sinonimi: ['note', 'nota', 'annotazioni', 'osservazioni'] },
];
export const CAMPI_KEYS = CAMPI.map((c) => c.k);
const PER_K = Object.fromEntries(CAMPI.map((c) => [c.k, c]));

/** Normalizzazione di un'intestazione: minuscole, senza accenti, "%" conservato, il resto della punteggiatura diventa spazio. */
export function normIntestazione(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/€/g, ' ').replace(/[^a-z0-9%]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Punteggio di un'intestazione per un campo: 100 = uguale a un sinonimo, 60 = contiene un sinonimo di più parole o la parola intera,
 * 0 = nessuna somiglianza. Il primo sinonimo della lista pesa di più a parità (più specifico).
 */
function punteggio(h, campo) {
  const n = normIntestazione(h);
  if (!n) return 0;
  let best = 0;
  campo.sinonimi.forEach((s, i) => {
    const bonus = (campo.sinonimi.length - i) / 100;
    if (n === s) best = Math.max(best, 100 + bonus);
    else if ((` ${n} `).includes(` ${s} `)) best = Math.max(best, 60 + s.split(' ').length + bonus);
  });
  return best;
}

/**
 * Riconoscimento delle colonne: intestazioni → { mapping: { campo: indice }, mancanti: [campi obbligatori non trovati], dettaglio }.
 * Ogni colonna va a un solo campo e ogni campo a una sola colonna (assegnazione per punteggio decrescente). Una colonna "Prezzo"
 * da sola è il listino; se ci sono due prezzi, quello con "scontato/offerto/netto" è l'offerto.
 */
export function riconosciColonne(intestazioni = []) {
  const coppie = [];
  intestazioni.forEach((h, i) => { for (const c of CAMPI) { const p = punteggio(h, c); if (p > 0) coppie.push({ i, k: c.k, p }); } });
  coppie.sort((a, b) => b.p - a.p || a.i - b.i);
  const mapping = {}; const usate = new Set();
  for (const x of coppie) {
    if (mapping[x.k] != null || usate.has(x.i)) continue;
    mapping[x.k] = x.i; usate.add(x.i);
  }
  const mancanti = CAMPI.filter((c) => c.obbligatorio && mapping[c.k] == null).map((c) => c.k);
  const dettaglio = Object.fromEntries(Object.entries(mapping).map(([k, i]) => [k, String(intestazioni[i] ?? '')]));
  return { mapping, mancanti, dettaglio };
}

/** Riga di intestazione: la prima (entro le prime 20) che riconosce almeno descrizione e listino, altrimenti quella con più campi. */
export function trovaIntestazione(righe = []) {
  let best = { indice: -1, n: 0 };
  for (let r = 0; r < Math.min(20, righe.length); r++) {
    const { mapping, mancanti } = riconosciColonne(righe[r] || []);
    const n = Object.keys(mapping).length;
    if (!mancanti.length && n >= 2) return { indice: r, mapping };
    if (n > best.n) best = { indice: r, n, mapping };
  }
  return best.indice >= 0 ? { indice: best.indice, mapping: best.mapping } : { indice: -1, mapping: {} };
}

/** Numero da una cella: 12.5, "12,50", "1.234,50 €", "€ 12", "20%", "-" → null. */
export function numero(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object' && v !== null && 'result' in v) return numero(v.result);
  let s = String(v).replace(/[€\s%]/g, '').replace(/eur/i, '');
  if (!s || s === '-') return null;
  if (/,\d{1,4}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');      // 1.234,50
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');   // 1,234.50
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const r1 = (n) => Math.round((Number(n) + Number.EPSILON) * 10) / 10;
const testo = (v) => {
  if (v == null) return '';
  if (typeof v === 'object') { if ('richText' in v) return v.richText.map((t) => t.text).join(''); if ('result' in v) return testo(v.result); if ('text' in v) return String(v.text); }
  return String(v).trim();
};

/**
 * Sconto di una colonna come percentuale (20 = 20%). Se tutti i valori della colonna sono tra 0 e 1 la colonna è in frazioni
 * (0,2 = 20%); un valore negativo (-20) indica lo stesso sconto scritto come variazione.
 */
export function scontoInPercentuale(valori) {
  const nums = valori.map(numero).filter((x) => x != null);
  const frazioni = nums.length > 0 && nums.every((x) => Math.abs(x) <= 1);
  return (v) => { const n = numero(v); if (n == null) return null; const p = Math.abs(n) * (frazioni ? 100 : 1); return r2(p); };
}

/**
 * Righe del foglio → righe del listino. dati: array di righe (array di celle) dopo l'intestazione. Righe vuote, di totale o senza
 * descrizione e senza prezzi si scartano. Prezzo offerto mancante = listino × (1 − sconto); sconto mancante = calcolato.
 * Ritorna { righe, scartate, avvisi }.
 */
export function leggiRighe(dati = [], mapping = {}) {
  const cella = (row, k) => (mapping[k] == null ? null : row[mapping[k]]);
  const conv = scontoInPercentuale(dati.map((row) => cella(row, 'sconto')));
  const righe = []; let scartate = 0; const avvisi = [];
  for (const row of dati) {
    const descrizione = testo(cella(row, 'descrizione'));
    const codice = testo(cella(row, 'codice'));
    let listino = numero(cella(row, 'listino'));
    let offerto = numero(cella(row, 'offerto'));
    let sconto = conv(cella(row, 'sconto'));
    if (!descrizione && !codice) { scartate++; continue; }
    if (/^\s*(totale|totali|subtotale|total)\b/i.test(descrizione) && !codice) { scartate++; continue; }
    if (listino == null && offerto == null) { scartate++; continue; }
    if (offerto == null && listino != null) offerto = sconto != null ? r2(listino * (1 - sconto / 100)) : listino;
    if (listino == null && offerto != null) { listino = offerto; if (sconto == null) sconto = 0; }
    if (sconto == null) sconto = listino > 0 ? r2((1 - offerto / listino) * 100) : 0;
    if (offerto > listino + 0.005) avvisi.push(`${codice || descrizione}: prezzo offerto superiore al listino`);
    righe.push({ codice: codice || null, descrizione: descrizione || codice, settore: testo(cella(row, 'settore')) || null, listino: r2(listino), offerto: r2(offerto), sconto: r2(sconto),
      unita: testo(cella(row, 'unita')) || null, note: testo(cella(row, 'note')) || null });
  }
  return { righe, scartate, avvisi: avvisi.slice(0, 20) };
}

/** Riepilogo: numero di esami, totali, sconto medio ponderato sul listino (1 − Σofferto/Σlistino) e semplice (media degli sconti). */
export function riepilogo(righe = []) {
  const tl = r2(righe.reduce((s, x) => s + Number(x.listino || 0), 0));
  const to = r2(righe.reduce((s, x) => s + Number(x.offerto || 0), 0));
  const sp = righe.length ? r1(righe.reduce((s, x) => s + Number(x.sconto || 0), 0) / righe.length) : 0;
  const settori = [...new Set(righe.map((x) => x.settore).filter(Boolean))];
  return { esami: righe.length, totale_listino: tl, totale_offerto: to, sconto_medio: tl > 0 ? r1((1 - to / tl) * 100) : 0, sconto_medio_semplice: sp,
    scontati: righe.filter((x) => Number(x.sconto) > 0).length, settori: settori.length };
}

export const chiaveRiga = (x) => (x.codice ? `c:${String(x.codice).trim().toUpperCase()}` : `d:${normIntestazione(x.descrizione)}`);
/**
 * Differenze tra due versioni (per codice, o per descrizione se il codice manca): aggiunte, tolte, cambiate (prezzo offerto o
 * listino), invariate, e la variazione dello sconto medio. Le righe cambiate portano i valori prima e dopo.
 */
export function differenze(prima = [], dopo = []) {
  const a = new Map(prima.map((x) => [chiaveRiga(x), x]));
  const b = new Map(dopo.map((x) => [chiaveRiga(x), x]));
  const aggiunte = []; const tolte = []; const cambiate = []; let invariate = 0;
  for (const [k, x] of b) {
    const y = a.get(k);
    if (!y) { aggiunte.push(x); continue; }
    if (Math.abs(Number(x.offerto) - Number(y.offerto)) > 0.005 || Math.abs(Number(x.listino) - Number(y.listino)) > 0.005) {
      cambiate.push({ codice: x.codice, descrizione: x.descrizione, listino_prima: y.listino, listino_dopo: x.listino, offerto_prima: y.offerto, offerto_dopo: x.offerto, sconto_prima: y.sconto, sconto_dopo: x.sconto });
    } else invariate++;
  }
  for (const [k, y] of a) if (!b.has(k)) tolte.push(y);
  const ra = riepilogo(prima); const rb = riepilogo(dopo);
  return { aggiunte, tolte, cambiate, invariate, sconto_medio_prima: ra.sconto_medio, sconto_medio_dopo: rb.sconto_medio, variazione_sconto: r1(rb.sconto_medio - ra.sconto_medio),
    chiavi_cambiate: cambiate.map((x) => (x.codice ? `c:${String(x.codice).toUpperCase()}` : `d:${normIntestazione(x.descrizione)}`)) };
}

/** Versione corrente: quella scelta (listino_corrente_id) se esiste ancora, altrimenti l'ultima. versioni: [{ id, versione }]. */
export function versioneCorrente(versioni = [], sceltaId = null) {
  if (!versioni.length) return null;
  const scelta = sceltaId ? versioni.find((v) => Number(v.id) === Number(sceltaId)) : null;
  return scelta || [...versioni].sort((x, y) => y.versione - x.versione)[0];
}

/** Righe raggruppate per settore (ordine di prima comparsa; senza settore: "Esami"). */
export function perSettore(righe = []) {
  const m = new Map();
  for (const x of righe) { const s = x.settore || 'Esami'; if (!m.has(s)) m.set(s, []); m.get(s).push(x); }
  return [...m.entries()].map(([settore, l]) => ({ settore, righe: l }));
}

// ---------------------------------------------------------------- lettura del file
/** Celle di un foglio exceljs come array di righe (valori semplici: numeri, testi, date ISO). */
function righeFoglio(ws) {
  const out = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const vals = [];
    row.eachCell({ includeEmpty: true }, (c, col) => {
      let v = c.value;
      if (v && typeof v === 'object') {
        if (v instanceof Date) v = v.toISOString().slice(0, 10);
        else if ('result' in v) v = v.result;
        else if ('richText' in v) v = v.richText.map((t) => t.text).join('');
        else if ('text' in v) v = v.text;
        else if ('error' in v) v = null;
      }
      vals[col - 1] = v;
    });
    out[n - 1] = vals;
  });
  return Array.from(out, (r) => r || []);
}
/** CSV (separatore ; , o tab, virgolette) → righe. */
export function righeCsv(txt) {
  const s = String(txt || '').replace(/^﻿/, '');
  const prima = s.split(/\r?\n/)[0] || '';
  const sep = [';', '\t', ','].map((c) => [c, prima.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const out = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); out.push(row); row = []; cur = ''; } else cur += ch;
  }
  if (cur || row.length) { row.push(cur); out.push(row); }
  return out;
}

/**
 * Lettura del file caricato (XLSX o CSV) con il mapping salvato o riconosciuto. Ritorna { foglio, fogli, intestazione_riga,
 * intestazioni, mapping, riconosciuto, mancanti, righe, scartate, avvisi, riepilogo }. mappingForzato: { campo: indice } scelto a video.
 */
export async function leggiListino(buffer, filename, { mappingSalvato = null, mappingForzato = null, foglio = null } = {}) {
  let tabelle = []; let fogli = [];
  if (/\.csv$/i.test(filename || '')) { tabelle = [righeCsv(buffer.toString('utf8'))]; fogli = ['CSV']; }
  else {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buffer); } catch { throw Object.assign(new Error('File non leggibile: carica l\'Excel esportato da StudioLAB in formato .xlsx (o un .csv)'), { status: 400 }); }
    fogli = wb.worksheets.map((w) => w.name);
    tabelle = wb.worksheets.map(righeFoglio);
  }
  // foglio: quello indicato, altrimenti il primo con una riga di intestazione riconosciuta
  let idx = foglio != null && fogli.includes(foglio) ? fogli.indexOf(foglio) : -1;
  if (idx < 0) idx = Math.max(0, tabelle.findIndex((t) => { const h = trovaIntestazione(t); return h.indice >= 0 && !riconosciColonne(t[h.indice]).mancanti.length; }));
  const t = tabelle[idx] || [];
  const h = trovaIntestazione(t);
  const intestazioneRiga = h.indice >= 0 ? h.indice : 0;
  const intestazioni = (t[intestazioneRiga] || []).map((x) => testo(x));
  const auto = riconosciColonne(intestazioni);
  // il mapping salvato vale se le sue colonne esistono e hanno ancora la stessa intestazione
  const salvatoValido = mappingSalvato?.mapping && Object.entries(mappingSalvato.mapping).every(([k, i]) => i == null || normIntestazione(intestazioni[i]) === normIntestazione(mappingSalvato.intestazioni?.[i]));
  const mapping = mappingForzato || (auto.mancanti.length && salvatoValido ? mappingSalvato.mapping : auto.mapping);
  const mancanti = CAMPI.filter((c) => c.obbligatorio && (mapping[c.k] == null || mapping[c.k] === '')).map((c) => c.k);
  const letto = mancanti.length ? { righe: [], scartate: 0, avvisi: [] } : leggiRighe(t.slice(intestazioneRiga + 1), mapping);
  return { foglio: fogli[idx] || null, fogli, intestazione_riga: intestazioneRiga + 1, intestazioni, mapping, riconosciuto: !mappingForzato && !auto.mancanti.length,
    da_mapping_salvato: Boolean(!mappingForzato && auto.mancanti.length && salvatoValido), mancanti, ...letto, riepilogo: riepilogo(letto.righe), campi: CAMPI.map((c) => ({ k: c.k, label: c.label, obbligatorio: Boolean(c.obbligatorio) })) };
}
export const etichettaCampo = (k) => PER_K[k]?.label || k;

// ---------------------------------------------------------------- revisione del listino/offerta (richiesta del CEO del 07/11/2026)
// "nel listino/offerta devi prevedere una sezione di revisione listino/offerta in cui può cambiare anche solo un prezzo e noi rigeneriamo
// a quel punto solo il PDF del listino/offerta e mandiamo rifirmato solo quello". Regola pura: dalle righe della versione di partenza e
// dalle modifiche ({ chiave, offerto, listino? }) le righe della nuova versione (sconto ricalcolato), le differenze con la funzione di
// sempre e il riepilogo. Errori espliciti: chiave sconosciuta o ripetuta, prezzo non numerico o negativo, nessun prezzo cambiato.
const prezzoValido = (v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0;
export function applicaRevisione(righe = [], modifiche = []) {
  if (!Array.isArray(modifiche) || !modifiche.length) throw Object.assign(new Error('Nessun prezzo modificato'), { status: 400 });
  const chiavi = new Set(righe.map(chiaveRiga));
  const perChiave = new Map();
  for (const m of modifiche) {
    const k = String(m?.chiave || '');
    if (!chiavi.has(k)) throw Object.assign(new Error(`Riga non presente nella versione di partenza: ${k || '(vuota)'}`), { status: 400 });
    if (perChiave.has(k)) throw Object.assign(new Error(`Riga indicata due volte: ${k}`), { status: 400 });
    if (!prezzoValido(m.offerto)) throw Object.assign(new Error(`Prezzo offerto non valido per ${k}: serve un numero maggiore o uguale a zero`), { status: 400 });
    if (m.listino !== undefined && m.listino !== null && !prezzoValido(m.listino)) throw Object.assign(new Error(`Prezzo di listino non valido per ${k}: serve un numero maggiore o uguale a zero`), { status: 400 });
    perChiave.set(k, { offerto: r2(Number(m.offerto)), listino: m.listino == null ? null : r2(Number(m.listino)) });
  }
  const avvisi = [];
  const nuove = righe.map((x) => {
    const m = perChiave.get(chiaveRiga(x));
    if (!m) return { ...x };
    const listino = m.listino == null ? Number(x.listino) : m.listino;
    const offerto = m.offerto;
    if (offerto > listino + 0.005) avvisi.push(`${x.codice || x.descrizione}: prezzo offerto superiore al listino`);
    return { ...x, listino: r2(listino), offerto, sconto: listino > 0 ? r2((1 - offerto / listino) * 100) : 0 };
  });
  const diff = differenze(righe, nuove);
  if (!diff.cambiate.length) throw Object.assign(new Error('Nessun prezzo diverso dalla versione di partenza'), { status: 400 });
  return { righe: nuove, differenze: diff, riepilogo: riepilogo(nuove), cambiate: diff.cambiate, avvisi: [...new Set(avvisi)].slice(0, 20) };
}

/** Righe cambiate in testo (diario ed email): "- A1 Glicemia: 2,50 € → 2,00 €" (e il listino se cambia anche quello). */
export function testoRigheCambiate(cambiate = [], max = 50) {
  const e = (n) => `${new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0))} €`;
  const righe = cambiate.slice(0, max).map((x) => {
    const listino = Math.abs(Number(x.listino_prima) - Number(x.listino_dopo)) > 0.005 ? ` (listino ${e(x.listino_prima)} → ${e(x.listino_dopo)})` : '';
    return `- ${[x.codice, x.descrizione].filter(Boolean).join(' ')}: ${e(x.offerto_prima)} → ${e(x.offerto_dopo)}${listino}`;
  });
  if (cambiate.length > max) righe.push(`- e altre ${cambiate.length - max} righe`);
  return righe.join('\n');
}
