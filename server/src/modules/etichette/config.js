// Configurazione del modulo Label (etichette provette). I parametri di lavoro (giorni delle identità, modelli, etichetta richiesta) sono
// impostazioni del modulo, non variabili d'ambiente.
// Zebra Browser Print: il programma locale di Zebra risponde su https://127.0.0.1:9101 e http://127.0.0.1:9100 (in quest'ordine).
// L'indirizzo è configurabile SOLO fuori produzione (ETICHETTE_BROWSER_PRINT_URL, elenco separato da virgole), per il collaudo con il
// finto Browser Print: in produzione valgono sempre gli indirizzi di Zebra. Gli stessi indirizzi entrano nella CSP (connect-src).
const env = process.env;
const PRODUZIONE = env.NODE_ENV === 'production';
export const BROWSER_PRINT_ZEBRA = ['https://127.0.0.1:9101', 'http://127.0.0.1:9100'];
const daAmbiente = String(env.ETICHETTE_BROWSER_PRINT_URL || '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter((s) => /^https?:\/\/[^\s/]+$/.test(s));

export const config = {
  appName: 'Label',
  browserPrint: !PRODUZIONE && daAmbiente.length ? daAmbiente : BROWSER_PRINT_ZEBRA,
  // Job delle identità recenti: intervallo (minuti), ore di lavoro (ora di Roma, inizio incluso, fine esclusa), chiamate per giro
  identitaMinuti: Number(env.ETICHETTE_IDENTITA_MINUTI || 15),
  oraInizio: 6,
  oraFine: 22,
  maxChiamateGiro: 30,
  // Ricerca diretta nel gestionale (202 della cattura): tempo massimo complessivo dell'attesa
  attesaDirettaMs: Number(env.ETICHETTE_ATTESA_DIRETTA_MS || 20000),
};
