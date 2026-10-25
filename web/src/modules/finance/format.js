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
export const hours = (h) => (h == null ? '–' : h < 48 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} gg`);

export const ROLE = { SUPPORT: 'Finance Support', CEO: 'Amministratore Delegato (CEO)', CFO: 'Chief Financial Officer (CFO)', VIEWER: 'Consultazione' };
export const ROLE_SHORT = { SUPPORT: 'Finance Support', CEO: 'CEO', CFO: 'CFO', VIEWER: 'Consultazione' };
export const ROLE_HELP = {
  SUPPORT: 'Inserisce e modifica le istanze, carica gli allegati, invia in firma, registra l\'esecuzione.',
  CEO: 'Firma le istanze dal link ricevuto via email con accesso Microsoft 365. Vede tutto.',
  CFO: 'Firma le istanze dal link ricevuto via email con accesso Microsoft 365. Vede tutto.',
  VIEWER: 'Sola lettura su istanze, archivio e cruscotto.',
};
export const STATUS = {
  BOZZA: { label: 'Bozza', tone: 'grey' },
  IN_FIRMA: { label: 'In firma', tone: 'blue' },
  RIFIUTATA: { label: 'Rifiutata', tone: 'red' },
  FIRMATA: { label: 'Autorizzata', tone: 'green' },
  ESEGUITA: { label: 'Eseguita', tone: 'teal' },
  ANNULLATA: { label: 'Annullata', tone: 'grey' },
};
export const TIER = {
  SINGOLA: { label: 'Firma singola', tone: 'grey' },
  CONGIUNTA: { label: 'Congiunta AD + CFO', tone: 'mauve' },
  CDA: { label: 'Delibera CdA + congiunta', tone: 'red' },
};
export const DOC_TYPE = { FATTURA: 'Fattura', CONTRATTO: 'Contratto', ORDINE: 'Ordine', ALTRO: 'Altro' };
export const PAY_METHOD = { SEPA: 'Bonifico SEPA', URGENTE: 'Bonifico urgente', ESTERO: 'Bonifico estero', F24: 'F24', ALTRO: 'Altro' };
export const CHECKS = [
  ['budget', 'Il pagamento è coerente con il Piano Industriale, il Piano Finanziario e il budget approvati, o deriva da obblighi debitamente autorizzati dall\'organo sociale competente.'],
  ['aggregation', 'L\'importo è stato determinato aggregando le operazioni correlate (stessa controparte, progetto, accordo o finalità commerciale); non vi è frazionamento.'],
  ['documents', 'La documentazione di supporto (fattura, contratto, ordine, SAL, delibera) è disponibile e allegata.'],
  ['related_party', 'Il beneficiario non è parte correlata, ovvero si tratta di pagamento ordinario in esecuzione di un accordo con parte correlata già approvato dal CdA.'],
  ['cfo_consent', 'Ove il pagamento derivi da un contratto con impegno tra € 100.000 ed € 250.000, è stato acquisito il previo consenso scritto del CFO (Punto 2, lett. C).'],
  ['iban_verified', 'Le coordinate bancarie del beneficiario sono state verificate e, in caso di nuovo IBAN o di variazione, confermate tramite canale indipendente (prevenzione frodi).'],
];
export const EVENT = { CREATA: 'Creata', MODIFICATA: 'Modificata', INVIATA: 'Inviata in firma', RIINVIATA: 'Reinviata in firma', REINVIO: 'Link reinviati', SOLLECITO: 'Sollecito', FIRMA: 'Firma', FIRMATA: 'Autorizzata', RIFIUTO: 'Rifiuto', ESEGUITA: 'Eseguita', ANNULLATA: 'Annullata', ALLEGATO: 'Allegati', ALLEGATO_RIMOSSO: 'Allegato rimosso', ERRORE_PDF: 'Errore PDF', ERRORE_MAIL: 'Errore email' };
export const ROLE_SIGNER = { CEO: 'Amministratore Delegato', CFO: 'Chief Financial Officer' };
