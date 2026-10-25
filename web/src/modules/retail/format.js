const eurFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
const eurFmt0 = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
export const eur = (n) => (n == null || n === '' ? '–' : eurFmt.format(Number(n)));
export const eur0 = (n) => (n == null || n === '' ? '–' : eurFmt0.format(Number(n)));
export const eurShort = (n) => {
  const v = Number(n || 0);
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toLocaleString('it-IT', { maximumFractionDigits: 2 })} M€`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toLocaleString('it-IT', { maximumFractionDigits: 0 })} k€`;
  return eurFmt0.format(v);
};
export const num = (n) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(Number(n || 0));
export const pct = (n, d = 0) => (n == null || !Number.isFinite(Number(n)) ? '–' : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: d })}%`);
export const delta = (cur, prev) => (prev ? Math.round(((Number(cur) - Number(prev)) / Number(prev)) * 1000) / 10 : null);
export const itDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
export const addDays = (iso, n) => new Date(new Date(iso).getTime() + n * 86400000).toISOString().slice(0, 10);
export const bytes = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
export const age = (iso) => (iso ? Math.floor((Date.now() - new Date(iso)) / (365.25 * 86400000)) : null);
export const MONTHS = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];
export const MONTHS_SHORT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export const monthLabel = (ym) => { const [y, m] = String(ym).split('-'); return `${MONTHS_SHORT[Number(m) - 1]} ${y.slice(2)}`; };
export const WEEKDAYS = ['', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

export const ROLE = { ADMIN: 'Amministratore', RETAIL: 'Retail & Communications', SEDE: 'Site manager', VIEWER: 'Consultazione' };
export const ROLE_HELP = {
  ADMIN: 'Tutto: dati, campagne, promozioni, esposizione, connettori, utenti, impostazioni.',
  RETAIL: 'Gestisce clienti, prodotti, campagne, promozioni, import ed esposizione di tutte le sedi.',
  SEDE: 'Consulta la dashboard e aggiorna il book retail della propria sede (verifiche, foto, stato dei materiali).',
  VIEWER: 'Sola lettura su dashboard, clienti, prodotti, campagne e promozioni.',
};
export const KIND = { B2C: { label: 'B2C', tone: 'teal' }, B2B: { label: 'B2B', tone: 'mauve' } };
export const SEGMENT = { NUOVO: { label: 'Nuovo', tone: 'blue' }, RICORRENTE: { label: 'Ricorrente', tone: 'green' }, OCCASIONALE: { label: 'Occasionale', tone: 'grey' }, DORMIENTE: { label: 'Dormiente', tone: 'red' }, MAI: { label: 'Senza acquisti', tone: 'grey' } };
export const SEX = { F: 'Donna', M: 'Uomo' };
export const SITE_KIND = { LABORATORIO: 'Laboratorio', CENTRO_DIAGNOSTICO: 'Centro diagnostico', POLIAMBULATORIO: 'Poliambulatorio', PUNTO_PRELIEVI: 'Punto prelievi', HEADQUARTER: 'Sede direzionale' };
export const CHANNEL = { WEB: 'Sito web', TUOTEMPO: 'TuoTempo', APP: 'App', TELEFONO: 'Telefono / call center', SPORTELLO: 'Sportello', MMG: 'Medico di base', CUP: 'CUP', AZIENDA: 'Azienda (B2B)', CONVENZIONE: 'Convenzione', PASSAPAROLA: 'Passaparola', CAMPAGNA: 'Campagna', ALTRO: 'Altro' };
export const PAYMENT = { PRIVATO: 'Privato', SSN: 'SSN', CONVENZIONE: 'Convenzione', ASSICURAZIONE: 'Assicurazione', FONDO: 'Fondo sanitario', AZIENDA: 'Azienda' };
export const B2B_TYPE = { AZIENDA: 'Azienda (medicina del lavoro / welfare)', STRUTTURA: 'Struttura sanitaria', LABORATORIO: 'Laboratorio (service)', ASSICURAZIONE: 'Assicurazione', FONDO: 'Fondo sanitario', MMG: 'Medico / studio medico', FARMACIA: 'Farmacia', VETERINARIO: 'Veterinario', INTERNO: 'Interno (sedi TD, convenzioni interne)' };
export const CAMPAIGN_CHANNEL = { META: 'Meta (Facebook, Instagram)', GOOGLE: 'Google Ads', SMS: 'SMS', EMAIL: 'Email / newsletter', AFFISSIONI: 'Affissioni', STAMPA: 'Stampa', RADIO: 'Radio', MMG: 'Medici di base', EVENTO: 'Evento', PARTNER: 'Partner / aziende', INSTORE: 'In sede', SITO: 'Sito web', ALTRO: 'Altro' };
export const OBJECTIVE = { NOTORIETA: 'Notorietà del brand', ACQUISIZIONE: 'Acquisizione nuovi clienti', RIATTIVAZIONE: 'Riattivazione', UPSELL: 'Cross-selling / upsell', B2B: 'Sviluppo B2B' };
export const CAMPAIGN_STATUS = { PIANIFICATA: { label: 'Pianificata', tone: 'grey' }, ATTIVA: { label: 'Attiva', tone: 'green' }, CONCLUSA: { label: 'Conclusa', tone: 'blue' }, SOSPESA: { label: 'Sospesa', tone: 'red' } };
export const PROMO_STATUS = { BOZZA: { label: 'Bozza', tone: 'grey' }, APPROVATA: { label: 'Approvata', tone: 'blue' }, ATTIVA: { label: 'Attiva', tone: 'green' }, CONCLUSA: { label: 'Conclusa', tone: 'teal' }, ANNULLATA: { label: 'Annullata', tone: 'red' } };
export const DISCOUNT = { PERCENTUALE: 'Sconto percentuale', IMPORTO: 'Sconto in euro', PREZZO_FISSO: 'Prezzo fisso', PACCHETTO: 'Pacchetto a prezzo unico', OMAGGIO: 'Omaggio', NESSUNO: 'Nessuno sconto (servizio)' };
export const EXPO_STATUS = { DA_INSTALLARE: { label: 'Da installare', tone: 'grey' }, INSTALLATO: { label: 'Installato', tone: 'green' }, DA_SOSTITUIRE: { label: 'Da sostituire', tone: 'mauve' }, NON_CONFORME: { label: 'Non conforme', tone: 'red' }, RIMOSSO: { label: 'Rimosso', tone: 'grey' } };
export const MATERIAL_STATUS = ['DA_FARE', 'IN_PRODUZIONE', 'CONSEGNATO', 'PUBBLICATO', 'INVIATO', 'ATTIVO', 'FATTO'];
export const SOURCE = { GIPO: 'GIPO', TUOTEMPO: 'TuoTempo', STUDIOLAB: 'StudioLab', MANUALE: 'Manuale', IMPORT: 'Import', DEMO: 'Demo' };
export const AGE_BUCKET = ['< 18', '18-29', '30-44', '45-59', '60-74', '75+'];
