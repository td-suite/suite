const eurFmt = new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', useGrouping: 'always' });
export const eur = (n) => (n == null || n === '' ? '–' : eurFmt.format(Number(n)));
export const num = (n) => new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(Number(n || 0));
export const itDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
export const itDateTime = (d) => (d ? new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
export const bytes = (n) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);

export const ROLE = { ADMIN: 'Superamministratore', SERVICE: 'Service Manager', RETAIL: 'Retail Manager', MDL: 'MDL Manager', HQS: 'HQS Manager', VIEWER: 'Consultazione' };
export const ROLE_HELP = {
  ADMIN: 'Tutte le sezioni, utenti, impostazioni e registro attività.',
  SERVICE: 'Crea e gestisce proposte e contratti di Service di Laboratorio, listini e credenziali del portale. Legge tutto il resto.',
  RETAIL: 'Crea e gestisce i contratti dei Punti Prelievo e il relativo fascicolo di autorizzazione. Legge tutto il resto.',
  MDL: 'Crea e gestisce proposte e contratti di Medicina del Lavoro, listini e credenziali del portale. Legge tutto il resto.',
  HQS: 'Compila il fascicolo di autorizzazione sanitaria dei Punti Prelievo (documenti, liste di autovalutazione, personale, strumentazione). Legge tutto il resto.',
  VIEWER: 'Sola lettura su tutte le sezioni.',
};
export const KIND = {
  PP: { label: 'Punti Prelievo', one: 'Punto Prelievi', doc: 'Contratto di appalto', tone: 'teal', path: 'punti-prelievo' },
  SRV: { label: 'Service di Laboratorio', one: 'Service di Laboratorio', doc: 'Lettera di offerta (MOD230)', tone: 'blue', path: 'service' },
  MDL: { label: 'Medicina del Lavoro', one: 'Medicina del Lavoro', doc: 'Lettera di offerta (MOD231)', tone: 'mauve', path: 'medicina-del-lavoro' },
  SEDE: { label: 'Sedi TD in locazione', one: 'Sede TD in locazione', doc: 'Contratto di locazione del locatore', tone: 'green', path: 'sedi' },
};
export const HAS_DOSSIER = (k) => k === 'PP' || k === 'SEDE';
// Tipi delle sedi TD dell'anagrafica unica (public.sites.kind; SERVICE sono i punti dei clienti service, fuori dal modulo)
export const SITE_KIND = { HEADQUARTER: 'Sede direzionale', LABORATORIO: 'Laboratorio', CENTRO_DIAGNOSTICO: 'Centro diagnostico', POLIAMBULATORIO: 'Poliambulatorio', PUNTO_PRELIEVI: 'Punto prelievi', CENTRO_MEDICO: 'Centro medico', ALTRO: 'Altra sede' };
export const SITE_TYPE = { LABORATORIO: 'Laboratorio di Analisi', PUNTO_PRELIEVI: 'Punto Prelievi', CENTRO_POLIDIAGNOSTICO: 'Centro Polidiagnostico', ALTRO: 'Altra sede' };
export const RENT_PERIOD = { MESE: 'al mese', TRIMESTRE: 'a trimestre', ANNO: 'all’anno' };
export const KIND_BY_PATH = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [v.path, k]));
export const STATUS = {
  BOZZA: { label: 'Bozza', tone: 'grey' },
  PROPOSTA: { label: 'Proposta inviata', tone: 'blue' },
  FIRMATO: { label: 'Firmato', tone: 'green' },
  AUTORIZZATO: { label: 'Autorizzato', tone: 'teal' },
  ATTIVO: { label: 'Attivo', tone: 'teal' },
  CESSATO: { label: 'Cessato', tone: 'grey' },
  ANNULLATO: { label: 'Annullato', tone: 'red' },
};
export const DOSSIER_STATUS = { IN_CORSO: { label: 'In preparazione', tone: 'blue' }, PRESENTATO: { label: 'Presentato al Comune', tone: 'mauve' }, AUTORIZZATO: { label: 'Autorizzato', tone: 'green' } };
export const DOC_STATUS = { MANCANTE: { label: 'Mancante', tone: 'red' }, GENERATO: { label: 'Generato, da firmare', tone: 'blue' }, COMPILATO: { label: 'Compilato', tone: 'blue' }, CARICATO: { label: 'Caricato', tone: 'green' }, NON_APPLICABILE: { label: 'Non applicabile', tone: 'grey' } };
export const FILE_CAT = { GENERATO_DOCX: 'Documento generato (DOCX)', GENERATO_PDF: 'Documento generato (PDF)', FIRMATO: 'Contratto firmato', LISTINO_XLSX: 'Listino (XLSX)', LISTINO_PDF: 'Listino (PDF)', PLANIMETRIA: 'Planimetria', ASSICURAZIONE: 'Assicurazione', ALTRO: 'Altro' };
export const EVENT = { CREATO: 'Creato', MODIFICATO: 'Modificato', GENERATO: 'Proposta generata', FIRMATO: 'Firmato', ALLEGATO: 'File caricato', ALLEGATO_RIMOSSO: 'File rimosso', ATTIVO: 'Attivato', CESSATO: 'Cessato', ANNULLATO: 'Annullato', AUTORIZZATO: 'Autorizzato', CREDENZIALI: 'Credenziali', CREDENZIALI_VISUALIZZATE: 'Password visualizzata', FASCICOLO_GENERATO: 'Fascicolo: generato', FASCICOLO_CARICATO: 'Fascicolo: caricato', FASCICOLO_RIMOSSO: 'Fascicolo: rimosso' };
// Etichetta di controparte e sede TD di un contratto o di un fascicolo (una delle due può mancare)
export const partyLabel = (x) => [x.org_name, x.site_name].filter(Boolean).join(' · ') || '–';
export const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export const FEE_VAT = { PIU_IVA: 'oltre IVA', IVA_INCLUSA: 'IVA inclusa', ESENTE: 'esente IVA art. 10' };
export const FEE_PERIOD = { MESE: 'al mese', TRIMESTRE: 'a trimestre', ANNO: 'all’anno', UNA_TANTUM: 'una tantum' };
export const FEE_BASE = { PUNTO_PRELIEVI: 'fatturato del Punto Prelievi', CENTRO_DIAGNOSTICO: 'fatturato del Centro Diagnostico (Medicina Specialistica, Diagnostica per Immagini)', POLIAMBULATORIO: 'fatturato dell’attività poliambulatoriale', ALTRO: 'altra base (testo libero)' };
export const FEE_KIND = { PERCENT: '% sul fatturato', FIXED: 'Importo fisso', MINIMUM: 'Minimo garantito', TEXT: 'Condizione in testo libero' };
