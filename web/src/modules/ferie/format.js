// Formati del Piano Ferie: stati, date italiane, quantità, nomi delle aree, eventi della cronologia
export const STATO = {
  RICHIESTA: { label: 'In attesa', tone: 'amber' }, APPROVATA: { label: 'Approvata', tone: 'green' }, RIFIUTATA: { label: 'Rifiutata', tone: 'red' },
  GODUTA: { label: 'Goduta', tone: 'teal' }, ANNULLATA: { label: 'Annullata', tone: 'grey' },
};
export const EVENTO = { RICHIESTA: 'Richiesta', APPROVATA: 'Approvazione', RIFIUTATA: 'Rifiuto', GODUTA: 'Goduta', ANNULLATA: 'Annullamento', PROMEMORIA: 'Promemoria all\'approvatore', MODIFICA: 'Modifica' };
export const MESI = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
export const GG = ['', 'L', 'M', 'M', 'G', 'V', 'S', 'D'];
export const itData = (s) => (s ? `${String(s).slice(8, 10)}/${String(s).slice(5, 7)}/${String(s).slice(0, 4)}` : '');
export const itDataOra = (d) => (d ? new Date(d).toLocaleString('it-IT', { timeZone: 'Europe/Rome', dateStyle: 'short', timeStyle: 'short' }) : '');
export const num = (n) => (n == null ? '' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 }));
export const oggiIso = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
export const periodo = (r) => {
  const a = itData(r.data_inizio), b = itData(r.data_fine);
  if (a === b) return `${a}${r.mezza_inizio ? ' (pomeriggio)' : r.mezza_fine ? ' (mattina)' : ''}`;
  return `${a}${r.mezza_inizio ? ' (pom.)' : ''} → ${b}${r.mezza_fine ? ' (mat.)' : ''}`;
};
export const quantita = (r) => (r.tipo === 'ROL' ? `${num(r.ore)} h ROL` : r.giorni != null ? `${num(r.giorni)} ${Number(r.giorni) === 1 ? 'giorno' : 'giorni'}` : '');
// Date di calendario (UTC per non farsi spostare dall'ora legale)
const pad = (n) => String(n).padStart(2, '0');
export const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const parseIso = (s) => new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10))));
export const addDays = (s, n) => { const d = parseIso(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
export const weekday = (s) => { const g = parseIso(s).getUTCDay(); return g === 0 ? 7 : g; };
export function giorniTra(a, b) { const out = []; for (let d = a; d <= b; d = addDays(d, 1)) out.push(d); return out; }
export function quotaInData(r, d) {
  if (d < r.data_inizio || d > r.data_fine) return 0;
  if (r.tipo === 'ROL') return d === r.data_inizio ? 0.25 : 0;
  if (d === r.data_inizio && r.mezza_inizio) return 0.5;
  if (d === r.data_fine && r.mezza_fine) return 0.5;
  return 1;
}
export function descriviEvento(e) {
  const d = e.dati || {};
  switch (e.tipo) {
    case 'RICHIESTA': return `Richiesta di ${d.ore ? `${num(d.ore)} ore` : `${num(d.giorni)} giorni`}${d.per_conto ? ' inserita da HR' : ''}${d.sotto_copertura ? ` · ${d.sotto_copertura} giorni sotto la copertura minima` : ''}`;
    case 'APPROVATA': return `Approvata${d.registrata_da_hr ? ' (registrata da HR)' : ''}${d.hr ? ' da HR' : ''}${d.nota ? `: ${d.nota}` : ''}${d.sotto_copertura ? ' nonostante l\'avviso di copertura' : ''}`;
    case 'RIFIUTATA': return `Rifiutata: ${d.nota || ''}`;
    case 'GODUTA': return d.automatico ? 'Goduta (passata automaticamente a data conclusa)' : 'Goduta';
    case 'ANNULLATA': return `Annullata${d.da_stato ? ` (era ${STATO[d.da_stato]?.label?.toLowerCase() || d.da_stato})` : ''}${d.motivo ? `: ${d.motivo}` : ''}`;
    case 'PROMEMORIA': return `Promemoria all'approvatore (in attesa da ${d.giorni_attesa} giorni)`;
    default: return EVENTO[e.tipo] || e.tipo;
  }
}
