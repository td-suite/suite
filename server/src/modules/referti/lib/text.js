// Pulizia del testo estratto dai PDF (pdftotext -layout): legature, simboli, spazi, colonne.
// Regole della specifica: ricongiungere le legature (ﬁ→fi, ﬂ→fl), conservare la virgola decimale e i simboli <=, >, /.

const LEGATURE = { 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬀ': 'ff', 'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st' };

export function pulisci(s) {
  if (s == null) return '';
  let t = String(s);
  t = t.replace(/[ﬁﬂﬀﬃﬄﬅﬆ]/g, (c) => LEGATURE[c] || c);
  t = t.replace(/ /g, ' ');            // spazio non interrompibile
  t = t.replace(/[‘’‚]/g, '\'').replace(/[“”]/g, '"');
  t = t.replace(/≤/g, '<=').replace(/≥/g, '>=');   // ≤ ≥
  t = t.replace(/−/g, '-');            // meno tipografico
  t = t.replace(/µ/g, 'µ');
  t = t.replace(/[\t\f\v]/g, ' ');
  t = t.replace(/\s+$/g, '');
  return t;
}

// Normalizza il testo di una pagina: legature, fine riga, righe vuote in coda
export function puliscaPagina(txt) {
  return String(txt || '').replace(/\r\n?/g, '\n').split('\n').map(pulisci).join('\n').replace(/\n{3,}/g, '\n\n');
}

// Spezza una riga "a colonne" (pdftotext -layout separa le colonne con due o più spazi)
export function colonne(riga) {
  return String(riga || '').trim().split(/\s{2,}/).map((x) => x.trim()).filter(Boolean);
}

// Posizione (indice di carattere) di inizio di ogni colonna in una riga di intestazione, per allineare le righe successive
export function posizioniColonne(riga, etichette) {
  const out = {};
  for (const e of etichette) { const i = riga.indexOf(e); if (i >= 0) out[e] = i; }
  return out;
}

// Taglia una riga alle posizioni dei caratteri (inizio incluso, fine esclusa) e la ripulisce
export const fetta = (riga, da, a) => String(riga || '').slice(Math.max(0, da || 0), a == null ? undefined : a).trim();

export const compattaSpazi = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// Un valore "spezzato" su più righe ricomposto con uno spazio ("Sviluppo di un" + "discreto" → "Sviluppo di un discreto")
export const ricomponi = (parti) => compattaSpazi(parti.filter(Boolean).join(' '));

// Maiuscolo "come in sorgente" ma senza spazi doppi
export const maiuscolo = (s) => compattaSpazi(s).toUpperCase();

// Nome file sicuro per Windows/OneDrive: niente caratteri vietati, spazi compattati
export const nomeFileSicuro = (s) => compattaSpazi(String(s || '').replace(/[\\/:*?"<>|]+/g, ' ')).slice(0, 150);

// Riconosce una data gg/mm/aaaa
export const RE_DATA = /\b(\d{2})\/(\d{2})\/(\d{4})\b/;
export const isData = (s) => RE_DATA.test(String(s || ''));

// Anagrafica abbreviata (es. "CRS LCN"): nessuna vocale in almeno una parola di 2+ lettere
export function anagraficaAbbreviata(nome) {
  const parole = String(nome || '').trim().split(/\s+/).filter((p) => /^[A-ZÀ-Ü']+$/i.test(p) && p.length >= 2);
  if (parole.length < 2) return parole.length === 1 && !/[AEIOUÀ-Ü]/i.test(parole[0]);
  return parole.some((p) => !/[AEIOUÀ-Ü]/i.test(p));
}
