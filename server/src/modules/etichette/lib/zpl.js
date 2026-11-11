// Label (etichette provette) · codice PURO condiviso: IDENTICO in server/src/modules/etichette/lib/zpl.js e
// web/src/modules/etichette/lib/zpl.js (lo verifica il test etichette.test.mjs). Nessuna dipendenza, nessun accesso a rete o database.
//  - Code 128 con codifica automatica B/C (insiemi B e C; A non serve per le etichette delle provette) e checksum modulo 103;
//  - riempimento del modello ZPL con i segnaposto {CAMPO} o {CAMPO:n} (troncato a n caratteri), valori ripuliti dai caratteri che in
//    ZPL hanno un significato (^ e ~) e campi rimasti vuoti tolti (un ^BC senza dati non si stampa);
//  - lettura (analisi) dei comandi ZPL usati dai modelli: ^XA ^XZ ^FO ^FD ^FS ^A0 ^BC ^BY ^GB ^CI ^PW ^LL ^FB, più ^LH ^CF ^FX
//    (commento) ^PQ; gli altri comandi si segnalano come non supportati (l'anteprima non li disegna, la stampante sì);
//  - resa in SVG di un'etichetta analizzata (anteprima a video e base del PDF di ripiego), in punti stampante (dot).
// La resa è un'approssimazione fedele nelle posizioni, nelle misure delle barre e nelle dimensioni dei caratteri; il carattere 0 della
// Zebra (CG Triumvirate Bold Condensed) è reso con un carattere condensato di sistema: le larghezze dei testi sono stimate.

// ------------------------------------------------------------------ Code 128
// Larghezze barra/spazio dei 107 simboli (0-102 dati, 103 Start A, 104 Start B, 105 Start C, 106 Stop a 7 elementi)
const PATTERN = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
export const C128 = { START_B: 104, START_C: 105, CODE_B: 100, CODE_C: 99, STOP: 106 };
const cifre = (s, i, n) => { for (let k = i; k < i + n; k++) { const c = s.charCodeAt(k); if (!(c >= 48 && c <= 57)) return false; } return i + n <= s.length; };
const quanteCifre = (s, i) => { let n = 0; while (i + n < s.length && s.charCodeAt(i + n) >= 48 && s.charCodeAt(i + n) <= 57) n++; return n; };

/**
 * Valori dei simboli Code 128 per `dati` (caratteri ASCII 32-126). modo 'A' (automatico, come ^BC...,A della Zebra): insieme C per i
 * gruppi di cifre che conviene comprimere (tutto numerico pari da 2 cifre; 4+ cifre all'inizio o alla fine, 6+ in mezzo), B per il resto.
 * modo 'N' (^BC senza modo): insieme B, con i codici di invocazione ZPL ">;" (passa a C) e ">:" (passa a B) nei dati.
 * Ritorna { valori: [start, ..., checksum, stop], checksum, testo (senza codici di invocazione) } o lancia un errore leggibile.
 */
export function code128Valori(dati, { modo = 'A' } = {}) {
  const s = String(dati ?? '');
  if (!s.length) throw new Error('Code 128: nessun dato');
  const valori = [];
  let testo = '';
  let set = null;
  const cambia = (nuovo) => {
    if (set === nuovo) return;
    valori.push(set === null ? (nuovo === 'C' ? C128.START_C : C128.START_B) : (nuovo === 'C' ? C128.CODE_C : C128.CODE_B));
    set = nuovo;
  };
  const carB = (ch) => {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error(`Code 128: carattere non ammesso (codice ${c})`);
    valori.push(c - 32); testo += ch;
  };
  if (modo === 'N') {
    let i = 0;
    while (i < s.length) {
      if (s[i] === '>' && (s[i + 1] === ';' || s[i + 1] === ':')) { cambia(s[i + 1] === ';' ? 'C' : 'B'); i += 2; continue; }
      if (s[i] === '>' && /[0-9=5678]/.test(s[i + 1] || '')) throw new Error(`Code 128: codice di invocazione >${s[i + 1]} non supportato dall'anteprima`);
      if (set === null) cambia('B');
      if (set === 'C') {
        if (!cifre(s, i, 2)) throw new Error('Code 128: nell\'insieme C servono coppie di cifre');
        valori.push(Number(s.slice(i, i + 2))); testo += s.slice(i, i + 2); i += 2;
      } else { carB(s[i]); i += 1; }
    }
  } else {
    let i = 0;
    const n0 = quanteCifre(s, 0);
    if (n0 === s.length && n0 >= 2 && n0 % 2 === 0) cambia('C');
    else if (n0 >= 4) cambia('C');
    else cambia('B');
    while (i < s.length) {
      if (set === 'C') {
        if (cifre(s, i, 2)) { valori.push(Number(s.slice(i, i + 2))); testo += s.slice(i, i + 2); i += 2; continue; }
        cambia('B');
      }
      // insieme B: passa a C per un gruppo di cifre pari da 4 alla fine o da 6 in mezzo (cifra dispari lasciata in B prima del gruppo)
      const n = quanteCifre(s, i);
      const fine = i + n === s.length;
      if (n >= (fine ? 4 : 6)) {
        if (n % 2 === 1) { carB(s[i]); i += 1; }
        cambia('C');
        continue;
      }
      carB(s[i]); i += 1;
    }
  }
  let somma = valori[0];
  for (let k = 1; k < valori.length; k++) somma += valori[k] * k;
  const checksum = somma % 103;
  return { valori: [...valori, checksum, C128.STOP], checksum, testo };
}

/** Larghezze in moduli (barra, spazio, barra, ...) della sequenza di simboli: barre = indici pari. */
export function code128Moduli(valori) {
  const out = [];
  for (const v of valori) for (const ch of PATTERN[v]) out.push(Number(ch));
  return out;
}
/** Barre di un Code 128: [{ x, w }] in moduli a partire da 0 e larghezza totale in moduli. */
export function code128Barre(dati, opz = {}) {
  const { valori, checksum, testo } = code128Valori(dati, opz);
  const mod = code128Moduli(valori);
  const barre = [];
  let x = 0;
  mod.forEach((w, k) => { if (k % 2 === 0) barre.push({ x, w }); x += w; });
  return { barre, moduli: x, checksum, testo, valori };
}

// ------------------------------------------------------------------ modello e segnaposto
export const SEGNAPOSTO = ['BARCODE', 'ACCETTAZIONE', 'COGNOME', 'NOME', 'NASCITA', 'SESSO', 'DATA', 'ORA', 'CONTENITORE', 'MATERIALE', 'ESAMI', 'CLIENTE', 'SEDE', 'N', 'TOT'];
// Troncamento predefinito (caratteri) quando il segnaposto non ne indica uno: i nomi lunghi non escono dall'etichetta
export const LIMITI = { BARCODE: 40, ACCETTAZIONE: 24, COGNOME: 22, NOME: 18, NASCITA: 10, SESSO: 3, DATA: 10, ORA: 5, CONTENITORE: 22, MATERIALE: 22, ESAMI: 60, CLIENTE: 32, SEDE: 32, N: 3, TOT: 3 };
const RE_SEGNAPOSTO = /\{([A-Z]+)(?::(\d{1,3}))?\}/g;

/** Valore pronto per un campo ZPL: niente caratteri di controllo, ^ e ~ (comandi ZPL), spazi multipli ridotti. */
export function pulisciValore(v) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\^/g, ' ').replace(/~/g, '-').replace(/\s{2,}/g, ' ').trim();
}
/** Taglia a n caratteri (senza puntini: l'etichetta ha poco spazio). */
export const tronca = (s, n) => (n && s.length > n ? s.slice(0, n).trimEnd() : s);

/** Segnaposto del modello sconosciuti (non in SEGNAPOSTO). */
export function segnapostoSconosciuti(zpl) {
  const out = new Set();
  for (const m of String(zpl || '').matchAll(RE_SEGNAPOSTO)) if (!SEGNAPOSTO.includes(m[1])) out.add(m[0]);
  return [...out];
}

/**
 * Riempie il modello: {CAMPO} → valore ripulito e troncato al limite predefinito, {CAMPO:n} → troncato a n. I segnaposto sconosciuti
 * restano come sono (l'editor li segnala). Poi toglie i campi rimasti senza dati (togliCampiVuoti).
 */
export function riempiModello(zpl, valori = {}) {
  const pieno = String(zpl || '').replace(RE_SEGNAPOSTO, (tutto, nome, n) => {
    if (!SEGNAPOSTO.includes(nome)) return tutto;
    return tronca(pulisciValore(valori[nome]), n ? Number(n) : LIMITI[nome]);
  });
  return togliCampiVuoti(pieno);
}

/**
 * Toglie i campi (da ^FO/^FT al ^FS) il cui ^FD è vuoto o fatto solo di spazi e separatori: un codice a barre senza dati (etichetta
 * "richiesta" o campione senza barcode) non deve arrivare alla stampante, un testo vuoto non serve.
 */
export function togliCampiVuoti(zpl) {
  const s = String(zpl);
  let out = '';
  let i = 0;
  for (;;) {
    const m = s.slice(i).search(/\^F[OT]/i);
    if (m < 0) { out += s.slice(i); break; }
    const inizio = i + m;
    const fs = s.toUpperCase().indexOf('^FS', inizio);
    if (fs < 0) { out += s.slice(i); break; }
    const campo = s.slice(inizio, fs + 3);
    const fd = campo.toUpperCase().indexOf('^FD');
    const vuoto = fd >= 0 && /^[\s/·.,:;-]*$/.test(campo.slice(fd + 3, campo.length - 3));
    out += s.slice(i, inizio) + (vuoto ? '' : campo);
    i = fs + 3;
  }
  return out;
}

// ------------------------------------------------------------------ analisi dei comandi ZPL
export const COMANDI_SUPPORTATI = ['XA', 'XZ', 'FO', 'FD', 'FS', 'A', 'BC', 'BY', 'GB', 'CI', 'PW', 'LL', 'FB', 'LH', 'CF', 'FX', 'PQ'];
const num = (v, d) => { const n = Number(String(v ?? '').trim()); return v == null || String(v).trim() === '' || !Number.isFinite(n) ? d : n; };

/** Larghezza stimata (dot) di un testo nel carattere 0 con altezza h e larghezza w (proporzioni del carattere condensato). */
export function larghezzaTesto(testo, h, w = h) {
  let u = 0;
  for (const ch of String(testo || '')) {
    if (/[iIl1.,:;'|!]/.test(ch)) u += 0.26;
    else if (ch === ' ') u += 0.28;
    else if (/[MW@%]/.test(ch)) u += 0.78;
    else if (/[A-Z0-9]/.test(ch)) u += 0.56;
    else u += 0.5;
  }
  return u * (w || h) * 0.92;
}

/** Righe di un ^FB: a capo sulle parole entro la larghezza, al più `righe` righe (le eccedenti si sovrappongono all'ultima sulla Zebra:
 *  qui si tagliano), giustificazione L/C/R/J. */
function righeBlocco(testo, fb, h, w) {
  const parole = String(testo).replace(/\\&/g, '\n').split(/(\n| )/);
  const righe = [];
  let cur = '';
  for (const p of parole) {
    if (p === '\n') { righe.push(cur); cur = ''; continue; }
    if (p === ' ') { cur += ' '; continue; }
    if (cur.trim() && larghezzaTesto(cur + p, h, w) > fb.w) { righe.push(cur.trimEnd()); cur = p; } else cur += p;
  }
  if (cur.trim() || !righe.length) righe.push(cur.trimEnd());
  return { righe: righe.slice(0, Math.max(1, fb.righe)), tagliate: Math.max(0, righe.length - Math.max(1, fb.righe)) };
}

/**
 * Analizza un testo ZPL. opz: { larghezza, altezza } in dot (dimensioni del modello: valgono se mancano ^PW e ^LL).
 * Ritorna { etichette: [{ larghezza, altezza, elementi, quantita }], nonSupportati: ['^XY', ...], avvisi: [testo] }.
 * Elementi (coordinate in dot, origine in alto a sinistra): { tipo: 'testo', x, y, h, w, testo, righe?, bw?, giust? },
 * { tipo: 'box', x, y, w, h, t, colore, r }, { tipo: 'barcode', x, y, h, barre: [{x, w}], larghezza, testo, interpretazione, sopra }.
 */
export function analizzaZpl(zpl, { larghezza = 400, altezza = 200 } = {}) {
  const src = String(zpl || '').replace(/\r/g, '');
  const nonSupportati = new Set();
  const avvisi = [];
  const etichette = [];
  let et = null;
  let campo = null;
  const stato = { by: { w: 2, r: 3, h: 10 }, cf: { h: 9, w: 5 }, lh: { x: 0, y: 0 } };
  const nuova = () => ({ larghezza, altezza, elementi: [], quantita: 1 });
  // token: ^XX... o ~XX... fino al prossimo ^ o ~ (dentro ^FD i dati arrivano fino a ^FS)
  const tok = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c !== '^' && c !== '~') { i++; continue; }
    const cmd2 = src.slice(i + 1, i + 3).toUpperCase();
    if (cmd2 === 'FD' || cmd2 === 'FX') {
      const fine = src.indexOf('^FS', i + 3);
      const fx = cmd2 === 'FX' ? src.slice(i + 3).search(/[\^~]/) : -1;
      const stop = cmd2 === 'FX' ? (fx < 0 ? src.length : i + 3 + fx) : (fine < 0 ? src.length : fine);
      tok.push({ pre: c, cmd: cmd2, arg: src.slice(i + 3, stop) });
      i = stop;
      continue;
    }
    let j = i + 1;
    while (j < src.length && src[j] !== '^' && src[j] !== '~') j++;
    const corpo = src.slice(i + 1, j).replace(/\n/g, '');
    if (/^A[0-9A-Z@]/i.test(corpo) && !/^(?:A@)/i.test(corpo)) tok.push({ pre: c, cmd: 'A', font: corpo[1].toUpperCase(), arg: corpo.slice(2) });
    else tok.push({ pre: c, cmd: corpo.slice(0, 2).toUpperCase(), arg: corpo.slice(2) });
    i = j;
  }
  const nuovoCampo = () => ({ x: null, y: null, font: null, fb: null, bc: null, gb: null });
  for (const t of tok) {
    const a = t.arg.split(',');
    if (t.pre === '~') { nonSupportati.add(`~${t.cmd}`); continue; }
    switch (t.cmd) {
      case 'XA': et = nuova(); campo = nuovoCampo(); break;
      case 'XZ': if (et) etichette.push(et); et = null; campo = null; break;
      case 'FX': break;
      case 'CI': if (!['28', '27', '0', ''].includes(String(a[0] || '').trim())) avvisi.push(`^CI${t.arg}: codifica dei caratteri diversa da UTF-8 (^CI28)`); break;
      case 'PW': if (et) et.larghezza = num(a[0], et.larghezza); break;
      case 'LL': if (et) et.altezza = num(a[0], et.altezza); break;
      case 'LH': stato.lh = { x: num(a[0], 0), y: num(a[1], 0) }; break;
      case 'PQ': if (et) et.quantita = Math.max(1, num(a[0], 1)); break;
      case 'BY': stato.by = { w: Math.max(1, Math.min(10, num(a[0], stato.by.w))), r: num(a[1], stato.by.r), h: num(a[2], stato.by.h) }; break;
      case 'CF': stato.cf = { h: num(a[1], stato.cf.h), w: num(a[2], num(a[1], stato.cf.w)) }; break;
      default: break;
    }
    if (!et) { if (!['XA', 'XZ', 'FX', 'CI', 'LH', 'BY', 'CF'].includes(t.cmd) && t.cmd) nonSupportati.add(`^${t.cmd}`); continue; }
    switch (t.cmd) {
      case 'XA': case 'XZ': case 'FX': case 'CI': case 'PW': case 'LL': case 'LH': case 'PQ': case 'BY': case 'CF': break;
      case 'FO': campo.x = num(a[0], 0) + stato.lh.x; campo.y = num(a[1], 0) + stato.lh.y; break;
      case 'A': {
        if (t.font !== '0') avvisi.push(`^A${t.font}: l'anteprima usa il carattere 0 per tutti i testi`);
        const parti = t.arg.split(',');
        const o = /^[NRIB]$/i.test(parti[0]) ? parti.shift().toUpperCase() : (parti[0] === '' ? (parti.shift(), 'N') : 'N');
        if (o !== 'N') avvisi.push(`^A${t.font}${o}: testo ruotato, l'anteprima lo disegna orizzontale`);
        const h = num(parti[0], stato.cf.h);
        campo.font = { h, w: num(parti[1], h) };
        break;
      }
      case 'FB': campo.fb = { w: num(a[0], 0), righe: Math.max(1, num(a[1], 1)), spaz: num(a[2], 0), giust: String(a[3] || 'L').trim().toUpperCase() || 'L' }; break;
      case 'GB': {
        const t2 = Math.max(1, num(a[2], 1));
        campo.gb = { w: Math.max(t2, num(a[0], t2)), h: Math.max(t2, num(a[1], t2)), t: t2, colore: String(a[3] || 'B').trim().toUpperCase() === 'W' ? 'W' : 'B', r: Math.max(0, Math.min(8, num(a[4], 0))) };
        break;
      }
      case 'BC': {
        const o = String(a[0] || 'N').trim().toUpperCase() || 'N';
        if (o !== 'N') avvisi.push(`^BC${o}: codice a barre ruotato, l'anteprima lo disegna orizzontale`);
        const modo = String(a[5] || 'N').trim().toUpperCase() || 'N';
        if (!['N', 'A'].includes(modo)) avvisi.push(`^BC modo ${modo}: l'anteprima conosce solo i modi N e A`);
        campo.bc = { h: num(a[1], stato.by.h), interpretazione: String(a[2] || 'Y').trim().toUpperCase() !== 'N', sopra: String(a[3] || 'N').trim().toUpperCase() === 'Y', modo };
        break;
      }
      case 'FD': campo.fd = t.arg; break;
      case 'FS': {
        const x = campo.x ?? stato.lh.x, y = campo.y ?? stato.lh.y;
        if (campo.gb) {
          et.elementi.push({ tipo: 'box', x, y, ...campo.gb });
        } else if (campo.bc && campo.fd != null) {
          try {
            const b = code128Barre(campo.fd, { modo: campo.bc.modo === 'A' ? 'A' : 'N' });
            const mw = stato.by.w;
            const largh = b.moduli * mw;
            et.elementi.push({ tipo: 'barcode', x, y, h: campo.bc.h, modulo: mw, barre: b.barre.map((z) => ({ x: x + z.x * mw, w: z.w * mw })), larghezza: largh, testo: b.testo, checksum: b.checksum, interpretazione: campo.bc.interpretazione, sopra: campo.bc.sopra });
            if (x + largh > et.larghezza) avvisi.push(`Il codice a barre "${b.testo}" (${largh} dot) esce dall'etichetta larga ${et.larghezza} dot: riduci ^BY o sposta ^FO`);
          } catch (e) { avvisi.push(e.message); }
        } else if (campo.fd != null) {
          const f = campo.font || { h: stato.cf.h, w: stato.cf.w };
          const el = { tipo: 'testo', x, y, h: f.h, w: f.w, testo: campo.fd.replace(/\\&/g, ' ') };
          if (campo.fb) {
            const r = righeBlocco(campo.fd, campo.fb, f.h, f.w);
            Object.assign(el, { righe: r.righe, bw: campo.fb.w, giust: campo.fb.giust, spaz: campo.fb.spaz });
            if (r.tagliate) avvisi.push(`"${campo.fd.slice(0, 30)}": il testo supera le ${campo.fb.righe} righe del blocco ^FB`);
          } else if (x + larghezzaTesto(el.testo, f.h, f.w) > et.larghezza) avvisi.push(`"${el.testo.slice(0, 30)}" potrebbe uscire dall'etichetta (larghezza stimata)`);
          et.elementi.push(el);
        }
        campo = nuovoCampo();
        break;
      }
      default: nonSupportati.add(`^${t.cmd}`);
    }
  }
  if (et) { avvisi.push('Manca ^XZ alla fine dell\'etichetta'); etichette.push(et); }
  if (!etichette.length) avvisi.push('Nessuna etichetta: il modello deve iniziare con ^XA e finire con ^XZ');
  return { etichette, nonSupportati: [...nonSupportati], avvisi: [...new Set(avvisi)] };
}

// ------------------------------------------------------------------ resa SVG
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FONT = "'Arial Narrow','Roboto Condensed','Helvetica Neue',Arial,sans-serif";
/** Altezza del testo in chiaro sotto il codice a barre (dot), come la stampa Zebra con ^BY w. */
export const altezzaInterpretazione = (modulo) => Math.max(14, Math.round(9 * modulo + 4));

/**
 * SVG di un'etichetta analizzata (un elemento di analizzaZpl().etichette). opz: { dpi, larghezzaMm, altezzaMm, bordo } → dimensioni
 * in mm (stampa e PDF) e viewBox in dot. Sfondo bianco, nero puro, testi in grassetto condensato.
 */
let svgSeq = 0;
export function svgEtichetta(et, { dpi = 203, larghezzaMm = null, altezzaMm = null, bordo = true } = {}) {
  const clip = `et-clip-${++svgSeq}`;
  const dpmm = dpi / 25.4;
  const W = et.larghezza, H = et.altezza;
  const wmm = larghezzaMm || +(W / dpmm).toFixed(2), hmm = altezzaMm || +(H / dpmm).toFixed(2);
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${wmm}mm" height="${hmm}mm" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" role="img">`,
    `<defs><clipPath id="${clip}"><rect x="0" y="0" width="${W}" height="${H}"/></clipPath></defs>`,
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"${bordo ? ' stroke="#9aa5ab" stroke-width="1"' : ''}/>`, `<g clip-path="url(#${clip})">`];
  const testo = (x, y, h, w, s, anchor = 'start') => {
    // linea di base del carattere 0 a circa l'80% della cella (h); larghezza imposta alla stima del carattere condensato della Zebra
    // (textLength): l'anteprima ha le stesse proporzioni su ogni PC, qualunque carattere di sistema sostituisca quello della stampante
    const L = larghezzaTesto(s, h, w);
    const lung = String(s).trim() && L > 0 ? ` textLength="${L.toFixed(1)}" lengthAdjust="spacingAndGlyphs"` : '';
    return `<text x="${x}" y="${(y + h * 0.8).toFixed(1)}" font-family="${FONT}" font-weight="700" font-size="${h}" text-anchor="${anchor}"${lung} fill="#000">${esc(s)}</text>`;
  };
  for (const el of et.elementi) {
    if (el.tipo === 'box') {
      const nero = el.colore === 'W' ? '#fff' : '#000';
      if (el.t * 2 >= Math.min(el.w, el.h)) out.push(`<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="${el.r * Math.min(el.w, el.h) / 16}" fill="${nero}"/>`);
      else out.push(`<rect x="${el.x + el.t / 2}" y="${el.y + el.t / 2}" width="${el.w - el.t}" height="${el.h - el.t}" rx="${el.r * Math.min(el.w, el.h) / 16}" fill="none" stroke="${nero}" stroke-width="${el.t}"/>`);
    } else if (el.tipo === 'barcode') {
      const yb = el.sopra && el.interpretazione ? el.y + altezzaInterpretazione(el.modulo) + 2 : el.y;
      for (const b of el.barre) out.push(`<rect x="${b.x}" y="${yb}" width="${b.w}" height="${el.h}" fill="#000"/>`);
      if (el.interpretazione) {
        const hi = altezzaInterpretazione(el.modulo);
        const yt = el.sopra ? el.y : el.y + el.h + 2;
        out.push(testo(el.x + el.larghezza / 2, yt, hi, Math.round(hi * 0.9), el.testo, 'middle'));
      }
    } else if (el.tipo === 'testo') {
      if (el.righe) {
        el.righe.forEach((r, k) => {
          const y = el.y + k * (el.h + (el.spaz || 0));
          const anchor = el.giust === 'C' ? 'middle' : el.giust === 'R' ? 'end' : 'start';
          const x = el.giust === 'C' ? el.x + el.bw / 2 : el.giust === 'R' ? el.x + el.bw : el.x;
          out.push(testo(x, y, el.h, el.w, r, anchor));
        });
      } else out.push(testo(el.x, el.y, el.h, el.w, el.testo));
    }
  }
  out.push('</g></svg>');
  return out.join('');
}

/** Dimensioni in dot di un modello (mm e dpi). */
export const dotDaMm = (mm, dpi) => Math.round(Number(mm) * (Number(dpi) / 25.4));
