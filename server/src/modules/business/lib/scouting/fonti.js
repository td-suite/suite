// Ricerca prospect · FONTI UFFICIALI ed elenchi da file. Gli open data del Ministero della Salute (www.dati.salute.gov.it, licenza IODL
// 2.0) sono la fonte stabile: farmacie e parafarmacie aggiornate ogni giorno con partita IVA, ospedali e case di cura con i posti
// letto (ultimo anno pubblicato: 2023). Tracciati verificati sui file del 15/11/2026. Per RSA, poliambulatori e aziende non esiste un
// elenco ufficiale aggiornato e scaricabile: restano OpenStreetMap, l'inserimento a mano e il caricamento di un proprio elenco.
import { UA, normUrl, dominioDi } from './web.js';
import { pivaValida } from './estrai.js';
import { PROVINCE } from './scoperta.js';

const SITO = 'https://www.dati.salute.gov.it';
export const FONTI = {
  FARMACIE: { etichetta: 'Farmacie', ente: 'Ministero della Salute', aggiornamento: 'ogni giorno', pagina: `${SITO}/it/dataset/farmacie/`, categoria: 'FARMACIA', linee: ['PP', 'SRV'],
    nota: 'Tutte le farmacie aperte al pubblico, con partita IVA e indirizzo. In Toscana circa 1.270.' },
  PARAFARMACIE: { etichetta: 'Parafarmacie', ente: 'Ministero della Salute', aggiornamento: 'ogni giorno', pagina: `${SITO}/it/dataset/parafarmacie/`, categoria: 'FARMACIA', linee: ['PP', 'SRV'],
    nota: 'Esercizi autorizzati alla vendita di farmaci diversi dalle farmacie, con partita IVA. In Toscana circa 320.' },
  OSPEDALI: { etichetta: 'Ospedali e case di cura', ente: 'Ministero della Salute', aggiornamento: 'annuale (dati 2023)', pagina: `${SITO}/it/dataset/posti-letto-struttura-ospedaliera-2023/`, categoria: 'CASA_DI_CURA', linee: ['SRV'],
    nota: 'Strutture di ricovero pubbliche e private accreditate con i posti letto. In Toscana 59, di cui 20 case di cura private accreditate.' },
};

/** CSV con separatore e virgolette: righe come array di celle */
export function leggiCsv(testo, sep = null) {
  const t = String(testo || '').replace(/^﻿/, '');
  const prima = t.slice(0, t.indexOf('\n') < 0 ? t.length : t.indexOf('\n'));
  const s = sep || ([';', '\t', ','].map((c) => [c, prima.split(c).length]).sort((a, b) => b[1] - a[1])[0][0]);
  const righe = []; let riga = []; let cella = ''; let dentro = false;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (dentro) { if (c === '"') { if (t[i + 1] === '"') { cella += '"'; i += 1; } else dentro = false; } else cella += c; continue; }
    if (c === '"' && cella === '') dentro = true;
    else if (c === s) { riga.push(cella); cella = ''; }
    else if (c === '\n') { riga.push(cella); righe.push(riga); riga = []; cella = ''; }
    else if (c !== '\r') cella += c;
  }
  if (cella !== '' || riga.length) { riga.push(cella); righe.push(riga); }
  return righe.filter((r) => r.some((x) => String(x).trim() !== ''));
}
/** Buffer → testo: UTF-8 se valido, altrimenti Windows-1252 (i file annuali del Ministero non sono UTF-8) */
export function decodifica(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
const oggetti = (righe) => { const H = righe[0].map((h) => String(h).trim()); return righe.slice(1).map((r) => Object.fromEntries(H.map((h, i) => [h, String(r[i] ?? '').trim()]))); };
const vuoto = (v) => (v && v !== '-' ? v : null);
const numero = (v) => { const n = Number(String(v || '').replace(',', '.')); return Number.isFinite(n) && n !== 0 ? n : null; };
// "FARMACIA SILVESTRI DEL DOTT. ROSSI & C. SNC" → "Farmacia Silvestri del Dott. Rossi & C. SNC"
const PICCOLE = new Set(['di', 'del', 'della', 'dei', 'degli', 'delle', 'dello', 'da', 'e', 'ed', 'a', 'al', 'alla', 'in', 'il', 'la', 'le', 'lo', 'per', 'con', 'su']);
const SIGLE = new Set(['snc', 'srl', 'sas', 'spa', 'ss', 'srls', 'rsa', 'usl', 'asl', 'irccs', 'aou', 'onlus']);
export const maiuscolette = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase().split(' ').map((w, i) => {
  const nudo = w.replace(/[.,]/g, '');
  if (SIGLE.has(nudo)) return w.toUpperCase();
  if (i > 0 && PICCOLE.has(nudo)) return w;
  return w.replace(/(^|['’(\-.])([a-zà-ÿ])/g, (m, a, c) => a + c.toUpperCase());
}).join(' ');
const piva = (v) => { const p = String(v || '').replace(/\D/g, '').padStart(11, '0'); return pivaValida(p) ? p : null; };

/** Farmacie o parafarmacie del Ministero → candidati della Toscana ancora attivi (data di fine validità vuota) */
export function candidatiDaFarmacie(testo, { parafarmacie = false, province = null } = {}) {
  const righe = oggetti(leggiCsv(testo, ';'));
  const campo = parafarmacie ? { id: 'codice_identificativo_sito', nome: 'sito_logistico', piva: 'partita_iva' } : { id: 'cod_farmacia', nome: 'descrizione_farmacia', piva: 'p_iva' };
  if (righe.length && !(campo.id in righe[0])) throw new Error(`Il file non è l'elenco delle ${parafarmacie ? 'parafarmacie' : 'farmacie'} del Ministero (manca la colonna ${campo.id})`);
  const out = [];
  for (const r of righe) {
    if (String(r.regione).toUpperCase() !== 'TOSCANA' || vuoto(r.data_fine_validita)) continue;
    const prov = String(r.sigla_provincia || '').toUpperCase();
    if (!PROVINCE[prov] || (province && !province.includes(prov))) continue;
    if (!r[campo.nome] || !r[campo.id]) continue;
    out.push({ fonte: 'MINISTERO', fonte_ref: `${parafarmacie ? 'parafarmacia' : 'farmacia'}/${r[campo.id]}`, nome: maiuscolette(r[campo.nome]).slice(0, 200), categoria: 'FARMACIA', indirizzo: vuoto(r.indirizzo), cap: vuoto(r.cap),
      comune: r.comune ? maiuscolette(r.comune) : null, provincia: prov, lat: numero(r.latitudine), lon: numero(r.longitudine), telefono: null, email: null, sito: null, dominio: null, piva: piva(r[campo.piva]), operatore: null,
      tags: { elenco: parafarmacie ? 'Parafarmacie' : 'Farmacie', tipologia: parafarmacie ? 'Parafarmacia' : vuoto(r.descrizione_tipologia), frazione: vuoto(r.frazione), dal: vuoto(r.data_inizio_validita), pubblico: false } });
  }
  return out;
}
/** Posti letto per struttura ospedaliera (una riga per struttura e tipo di disciplina) → una struttura con il totale dei posti letto */
export function candidatiDaOspedali(testo, { province = null } = {}) {
  const righe = oggetti(leggiCsv(testo, ';'));
  if (righe.length && !('Codice struttura' in righe[0])) throw new Error('Il file non è "Posti letto per struttura ospedaliera" del Ministero (manca la colonna Codice struttura)');
  const per = new Map();
  for (const r of righe) {
    if (String(r['Descrizione Regione']).toUpperCase() !== 'TOSCANA') continue;
    const prov = String(r['Sigla provincia'] || '').toUpperCase();
    if (!PROVINCE[prov] || (province && !province.includes(prov))) continue;
    const k = r['Codice struttura']; if (!k || !r['Denominazione struttura']) continue;
    const tipo = r['Descrizione tipo struttura'] || '';
    const cur = per.get(k) || { fonte: 'MINISTERO', fonte_ref: `ospedale/${k}`, nome: maiuscolette(r['Denominazione struttura']).slice(0, 200), categoria: 'CASA_DI_CURA', indirizzo: maiuscolette(r.Indirizzo) || null, cap: null,
      comune: maiuscolette(r.Comune) || null, provincia: prov, lat: null, lon: null, telefono: null, email: null, sito: null, dominio: null, piva: null, operatore: null, posti: 0, anno: r.Anno,
      tags: { elenco: 'Ospedali e case di cura', tipologia: tipo, pubblico: !/casa di cura|privat/i.test(tipo), discipline: [] } };
    cur.posti += Number(r['Totale posti letto'] || 0) || 0;
    if (r['Tipo di Disciplina']) cur.tags.discipline.push(r['Tipo di Disciplina']);
    per.set(k, cur);
  }
  return [...per.values()].map(({ posti, anno, ...c }) => ({ ...c, tags: { ...c.tags, posti_letto: posti, anno },
    segnali: posti ? { POSTI_LETTO: { valore: posti, evidenza: `Ministero della Salute, posti letto per struttura ospedaliera ${anno}: ${c.tags.tipologia}`, url: FONTI.OSPEDALI.pagina }, ...(/accreditata/i.test(c.tags.tipologia) ? { ACCREDITATO: { valore: true, evidenza: `Ministero della Salute ${anno}: ${c.tags.tipologia}`, url: FONTI.OSPEDALI.pagina } } : {}) } : {} }));
}
export const convertitore = { FARMACIE: (t, o) => candidatiDaFarmacie(t, o), PARAFARMACIE: (t, o) => candidatiDaFarmacie(t, { ...o, parafarmacie: true }), OSPEDALI: (t, o) => candidatiDaOspedali(t, o) };

/** Scarica il file corrente di una fonte dal sito del Ministero: la pagina del dataset indica il file del giorno. { testo, file } */
export async function scaricaFonte(chiave, { fetchFn = fetch } = {}) {
  const f = FONTI[chiave]; if (!f) throw new Error('Fonte non prevista');
  const h = { 'User-Agent': UA, 'Accept-Language': 'it-IT,it;q=0.9', Accept: 'text/html,text/csv,*/*' };
  const manuale = `Scarica il file CSV da ${f.pagina} e caricalo qui con "Carica il file".`;
  let pagina;
  try { pagina = await fetchFn(process.env.SCOUTING_MINISTERO_URL ? `${process.env.SCOUTING_MINISTERO_URL}/${chiave}` : f.pagina, { headers: h, signal: AbortSignal.timeout(30_000) }); }
  catch (e) { throw new Error(`Il sito del Ministero non è raggiungibile dal server (${e.name === 'TimeoutError' ? 'nessuna risposta in tempo' : e.cause?.code || e.message}). ${manuale}`); }
  if (!pagina.ok) throw new Error(`Il sito del Ministero ha risposto ${pagina.status}${pagina.status === 403 ? ' (non accetta la richiesta dal server della Suite)' : ''}. ${manuale}`);
  const html = await pagina.text();
  const m = [...html.matchAll(/href\s*=\s*["']([^"']+\.csv)["']/gi)].map((x) => x[1].replace(/&amp;/g, '&'))[0];
  if (!m) throw new Error(`Nella pagina del Ministero non trovo il file CSV. ${manuale}`);
  const url = new URL(m, pagina.url || f.pagina).toString();
  const r = await fetchFn(url, { headers: h, signal: AbortSignal.timeout(120_000) });
  if (!r.ok) throw new Error(`Il file del Ministero ha risposto ${r.status}. ${manuale}`);
  return { testo: decodifica(new Uint8Array(await r.arrayBuffer())), file: decodeURIComponent(url.split('/').pop()) };
}

// ---------------------------------------------------------------- elenco proprio (CSV o Excel): colonne riconosciute dal nome
const COLONNE = [
  ['nome', /^(nome|denominazione|ragione\s*sociale|struttura|azienda|company(_?name)?|insegna|cliente|descrizione)$/i],
  ['sito', /^(sito(\s*web)?|website|web|url|dominio)$/i], ['piva', /^(p\.?\s*iva|partita\s*iva|piva|vat(\s*number)?|p_iva|partita_iva)$/i],
  ['indirizzo', /^(indirizzo|via|address|sede)$/i], ['cap', /^(cap|c\.a\.p\.?|zip)$/i], ['comune', /^(comune|citt[aà]|city|localit[aà])$/i], ['provincia', /^(prov(incia)?\.?|sigla(\s*|_)prov(incia)?|pr)$/i],
  ['telefono', /^(tel(efono)?\.?|phone|cellulare)$/i], ['email', /^(e-?mail|posta)$/i], ['operatore', /^(gruppo|gestore|ente(\s*gestore)?|operatore)$/i], ['note', /^(note|tipologia|tipo)$/i],
];
export function mappaColonne(intestazioni) {
  const out = {};
  intestazioni.forEach((h, i) => { const t = String(h || '').trim(); for (const [k, re] of COLONNE) if (out[k] === undefined && re.test(t)) { out[k] = i; break; } });
  return out;
}
/** Righe di un elenco proprio → candidati. La prima riga è l'intestazione; serve almeno la colonna del nome. */
export function candidatiDaElenco(righe, { categoria = 'ALTRO' } = {}) {
  if (!righe.length) throw new Error('Il file è vuoto');
  const m = mappaColonne(righe[0]);
  if (m.nome === undefined) throw new Error(`Non trovo la colonna con il nome della struttura. Colonne riconosciute: nome o denominazione o ragione sociale, sito, partita IVA, indirizzo, CAP, comune, provincia, telefono, email, gruppo. Trovate: ${righe[0].slice(0, 12).join(', ')}`);
  const v = (r, k) => (m[k] === undefined ? null : (String(r[m[k]] ?? '').trim() || null));
  const SIGLA = Object.fromEntries(Object.entries(PROVINCE).map(([k, n]) => [n.toUpperCase(), k]));
  const out = []; const visti = new Set();
  for (const r of righe.slice(1)) {
    const nome = v(r, 'nome'); if (!nome || nome.length < 2) continue;
    const sito = v(r, 'sito') ? normUrl(v(r, 'sito')) : null;
    const pr = String(v(r, 'provincia') || '').toUpperCase(); const prov = PROVINCE[pr] ? pr : SIGLA[pr] || (pr.length === 2 ? pr : null);
    const rif = (sito ? dominioDi(sito) : `${nome}|${v(r, 'comune') || ''}`).toLowerCase().slice(0, 200);
    if (visti.has(rif)) continue; visti.add(rif);
    out.push({ fonte: 'ELENCO', fonte_ref: rif, nome: nome.slice(0, 200), categoria, indirizzo: v(r, 'indirizzo'), cap: v(r, 'cap'), comune: v(r, 'comune'), provincia: prov, lat: null, lon: null, telefono: v(r, 'telefono'),
      email: v(r, 'email') && /@/.test(v(r, 'email')) ? v(r, 'email').toLowerCase() : null, sito, dominio: sito ? dominioDi(sito) : null, piva: piva(v(r, 'piva')), operatore: v(r, 'operatore'), tags: { elenco: 'File caricato', note: v(r, 'note'), pubblico: false } });
  }
  return out;
}
