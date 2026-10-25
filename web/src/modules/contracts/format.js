const eurFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
export const eur = (n) => (n == null || n === '' ? '–' : eurFmt.format(Number(n)));
export const eurShort = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 2 })} M€`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toLocaleString('it-IT', { maximumFractionDigits: 0 })} k€`;
  return eurFmt.format(v);
};
export const num = (n) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(Number(n || 0));
export const itDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
export const bytes = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
export const age = (iso) => (iso ? Math.floor((Date.now() - new Date(iso)) / (365.25 * 86400000)) : null);

export const ROLE = { ADMIN: 'Amministratore', HR: 'HR', VIEWER: 'Consultazione' };
export const ROLE_HELP = {
  ADMIN: 'Tutto: risorse, documenti, costi, utenti, impostazioni, CCNL, import.',
  HR: 'Inserisce e aggiorna risorse, genera documenti, gestisce dossier e scouting. Vede i costi.',
  VIEWER: 'Sola lettura su anagrafiche, dossier e scadenze, senza dati retributivi.',
};
export const KIND = { DIPENDENTE: { label: 'Dipendente', tone: 'teal' }, LP: { label: 'LP', tone: 'mauve' } };
export const STATUS = { CANDIDATO: { label: 'Candidato', tone: 'grey' }, IMPEGNO: { label: 'In impegno', tone: 'blue' }, ATTIVO: { label: 'Attivo', tone: 'green' }, CESSATO: { label: 'Cessato', tone: 'red' } };
export const CONTRACT = { TIND: 'Tempo indeterminato', TDET: 'Tempo determinato', APPRENDISTATO: 'Apprendistato', DIRIGENTE: 'Dirigente' };
export const LEVELS = ['Q', '1', '2', '3S', '3', '4S', '4', '5'];
export const LEVEL_LABEL = { Q: 'Quadro', 1: '1° livello', 2: '2° livello', '3S': '3° livello Super', 3: '3° livello', '4S': '4° livello Super', 4: '4° livello', 5: '5° livello', DIRIGENTE: 'Dirigente' };
export const LETTER_STATUS = { BOZZA: { label: 'Bozza', tone: 'grey' }, INVIATA: { label: 'Inviata', tone: 'blue' }, ACCETTATA: { label: 'Accettata', tone: 'green' }, RIFIUTATA: { label: 'Rifiutata', tone: 'red' }, SCADUTA: { label: 'Scaduta', tone: 'grey' }, CONVERTITA: { label: 'Convertita in assunzione', tone: 'teal' } };
export const CV_STATUS = { NUOVO: { label: 'Nuovo', tone: 'blue' }, IN_VALUTAZIONE: { label: 'In valutazione', tone: 'mauve' }, COLLOQUIO: { label: 'Colloquio', tone: 'teal' }, IN_ATTESA: { label: 'In attesa', tone: 'grey' }, SCARTATO: { label: 'Scartato', tone: 'red' }, CONVERTITO: { label: 'Convertito', tone: 'green' } };
export const DEADLINE_STATE = { SCADUTA: 'red', IMMINENTE: 'mauve', PROSSIMA: 'blue', PIANIFICATA: 'grey' };
export const FEE_TYPE = { FISSO: 'Fisso mensile', ORARIO: 'A ore', PRESTAZIONE: 'A prestazione', VARIABILE: '% sul fatturato' };
export const FEE_VAT = { CON: 'Con IVA', SENZA: 'Senza IVA' };
export const SEX = { F: 'Donna', M: 'Uomo' };

export const TERMINATION_LABEL = { DIMISSIONI: 'Dimissioni', LICENZIAMENTO: 'Licenziamento', SCADENZA_TERMINE: 'Scadenza del termine', RISOLUZIONE_CONSENSUALE: 'Risoluzione consensuale', PENSIONAMENTO: 'Pensionamento', FINE_INCARICO: 'Fine incarico professionale', RECESSO: 'Recesso dall\'incarico', ALTRO: 'Altro' };
