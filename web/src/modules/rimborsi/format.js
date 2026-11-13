// Formati e costanti del Rimborso Spese (stessa logica del server, lib/calcoli.js)
export const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
export const nomeMese = (anno, mese) => `${MESI[mese - 1]} ${anno}`;
export const eur = (n) => new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' }).format(Number(n || 0));
export const num = (n, d = 2) => Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d });
export const km = (n) => `${Number(n || 0).toLocaleString('it-IT', { maximumFractionDigits: 1 })} km`;
export const tariffa = (t) => (t == null ? 'manca' : `${Number(t).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} EUR/km`);
export const itData = (d) => { const s = String(d || '').slice(0, 10); return s ? `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}` : ''; };
export const itDataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const oggiIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
export const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
export const STATO = {
  BOZZA: { label: 'Bozza', tone: 'grey' },
  INVIATA: { label: 'Inviata al responsabile', tone: 'amber' },
  APPROVATA: { label: 'Approvata', tone: 'teal' },
  IN_LIQUIDAZIONE: { label: 'In liquidazione', tone: 'blue' },
  LIQUIDATA: { label: 'Liquidata', tone: 'green' },
  ARCHIVIATA: { label: 'Archiviata', tone: 'mauve' },
};
export const METODI = { DIPENDENTE: 'Anticipata da me', CARTA_AZIENDALE: 'Carta aziendale', FUEL_CARD: 'Fuel card' };
export const EVENTO = {
  CREATA: 'Nota creata', INVIATA: 'Inviata', APPROVATA: 'Approvata', RESPINTA: 'Respinta', RIGA_ESCLUSA: 'Riga esclusa', RIGA_INCLUSA: 'Riga di nuovo inclusa',
  IN_LIQUIDAZIONE: 'Presa in carico da P&C', RIMANDATA_RESPONSABILE: 'Rimandata al responsabile', RIMANDATA_DIPENDENTE: 'Rimandata al dipendente', LIQUIDATA: 'Liquidata',
  ARCHIVIATA: 'Archiviata con il PDF definitivo', PROMEMORIA: 'Promemoria inviato', RESPONSABILE_RICALCOLATO: 'Responsabile ricalcolato', PDF_APPROVAZIONE: 'Email al consulente',
};
export const saldoTesto = (s) => (Number(s) > 0 ? 'a favore del dipendente' : Number(s) < 0 ? 'a favore dell\'azienda' : 'nessun saldo');
