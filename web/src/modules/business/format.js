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
  PP: { label: 'Punti Prelievo', one: 'Punto Prelievi', doc: 'Contratto di appalto', tone: 'teal', path: 'contratti-pp' },   // elenco dei contratti PP (la pagina Punti Prelievo è l'elenco dei punti)
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
  ATTIVO: { label: 'In vigore', tone: 'teal' },   // stato del CONTRATTO; 'cliente attivo' è un'altra cosa e lo dichiara il CEO (07/11/2026)
  CESSATO: { label: 'Cessato', tone: 'grey' },
  ANNULLATO: { label: 'Annullato', tone: 'red' },
};
export const DOSSIER_STATUS = { IN_CORSO: { label: 'In preparazione', tone: 'blue' }, PRESENTATO: { label: 'Presentato al Comune', tone: 'mauve' }, AUTORIZZATO: { label: 'Autorizzato', tone: 'green' } };
export const DOC_STATUS = { MANCANTE: { label: 'Mancante', tone: 'red' }, GENERATO: { label: 'Generato, da firmare', tone: 'blue' }, COMPILATO: { label: 'Compilato', tone: 'blue' }, CARICATO: { label: 'Caricato', tone: 'green' }, NON_APPLICABILE: { label: 'Non applicabile', tone: 'grey' } };
export const FILE_CAT = { GENERATO_DOCX: 'Documento generato (DOCX)', GENERATO_PDF: 'Documento generato (PDF)', FIRMATO: 'Contratto firmato', LISTINO_XLSX: 'Listino (XLSX)', LISTINO_PDF: 'Listino (PDF)', PLANIMETRIA: 'Planimetria', ASSICURAZIONE: 'Assicurazione', ALTRO: 'Altro' };
export const EVENT = { CREATO: 'Creato', MODIFICATO: 'Modificato', GENERATO: 'Proposta generata', FIRMATO: 'Firmato', ALLEGATO: 'File caricato', ALLEGATO_RIMOSSO: 'File rimosso', ATTIVO: 'Attivato', CESSATO: 'Cessato', ANNULLATO: 'Annullato', AUTORIZZATO: 'Autorizzato', CREDENZIALI: 'Credenziali', CREDENZIALI_VISUALIZZATE: 'Password visualizzata', FASCICOLO_GENERATO: 'Fascicolo: generato', FASCICOLO_CARICATO: 'Fascicolo: caricato', FASCICOLO_RIMOSSO: 'Fascicolo: rimosso', REVISIONE: 'Nuova revisione', STATO_MANUALE: 'Stato cambiato a mano', IMPORTATO: 'Importato' };
// Etichetta di controparte e sede TD di un contratto o di un fascicolo (una delle due può mancare)
export const partyLabel = (x) => [x.org_name, x.site_name].filter(Boolean).join(' · ') || '–';
export const DAYS = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'];
export const FEE_VAT = { PIU_IVA: 'oltre IVA', IVA_INCLUSA: 'IVA inclusa', ESENTE: 'esente IVA art. 10' };
export const FEE_PERIOD = { MESE: 'al mese', TRIMESTRE: 'a trimestre', ANNO: 'all’anno', UNA_TANTUM: 'una tantum' };
export const FEE_BASE = { PUNTO_PRELIEVI: 'fatturato del Punto Prelievi', CENTRO_DIAGNOSTICO: 'fatturato del Centro Diagnostico (Medicina Specialistica, Diagnostica per Immagini)', POLIAMBULATORIO: 'fatturato dell’attività poliambulatoriale', ALTRO: 'altra base (testo libero)' };
export const FEE_KIND = { PERCENT: '% sul fatturato', FIXED: 'Importo fisso', MINIMUM: 'Minimo garantito', TEXT: 'Condizione in testo libero' };

// ---------------- Business Hub (06/11/2026) ----------------
// Fasi del percorso commerciale: 0 = prospect censito (nessuna data), 1..7; la 7 richiede il cliente attivo (lo dice il CEO)
export const FASI = [
  { n: 0, label: 'Prospect censito', short: 'Censiti', tone: 'grey' },
  { n: 1, label: 'Lead', short: '1. Lead', tone: 'grey' },
  { n: 2, label: 'Primo contatto', short: '2. Primo contatto', tone: 'blue' },
  { n: 3, label: 'Sopralluogo', short: '3. Sopralluogo', tone: 'blue' },
  { n: 4, label: 'Offerta inviata', short: '4. Offerta inviata', tone: 'mauve' },
  { n: 5, label: 'In negoziazione', short: '5. Negoziazione', tone: 'mauve' },
  { n: 6, label: 'Contratto firmato', short: '6. Contratto firmato', tone: 'green' },
  { n: 7, label: 'Attivo / Starting', short: '7. Attivo', tone: 'teal' },
];
export const LINEE = { SRV: { label: 'Service di Laboratorio', short: 'Service', tone: 'blue' }, PP: { label: 'Punti Prelievo', short: 'Punti prelievo', tone: 'teal' }, MDL: { label: 'Medicina del Lavoro', short: 'MDL', tone: 'mauve' } };
export const PRIORITA = { ALTA: { label: 'Alta', tone: 'red' }, MEDIA: { label: 'Media', tone: 'mauve' }, BASSA: { label: 'Bassa', tone: 'grey' } };
export const TIPO_ATTIVITA = { CHIAMATA: 'Chiamata', EMAIL_IN: 'Email ricevuta', EMAIL_OUT: 'Email inviata', INCONTRO: 'Incontro', SOPRALLUOGO: 'Sopralluogo', NOTA: 'Nota', OFFERTA: 'Offerta', CRITICITA: 'Criticità', SISTEMA: 'Sistema', PACCHETTO: 'Pacchetto',
  // processo Service (06/11/2026): ogni evento ha il suo tipo
  LISTINO: 'Listino caricato', OFFERTA_ECONOMICA: 'Offerta economica', ACCESSO: 'Accesso alla Suite', KIT: 'Kit di proposta', FORM_B2B: 'Form online', CONTRATTO_FIRMATO: 'Contratto firmato', ATTIVAZIONE: 'Attivazione servizi',
  // processo Punti Prelievo (06/11/2026): passi dell'avvio del punto prelievi
  AVVIO: 'Avvio punto prelievi' };
// Sottotipi delle email del processo (diario e registro invii)
export const SOTTOTIPO = { KIT_PROPOSTA: 'Kit di proposta', CONTRATTUALIZZAZIONE: 'Avvenuta contrattualizzazione', BENVENUTO: 'Benvenuto al cliente', NUOVO_CLIENTE_LAB: 'Nuovo cliente al laboratorio',
  RICHIAMO: 'Richiamo prospect', INVITO_SUITE: 'Invito alla Suite', RISPOSTA_KIT: 'Risposta del cliente',
  // revisione del listino/offerta (07/11/2026)
  REVISIONE: 'Revisione del listino/offerta', OFFERTA_REVISIONE: 'Offerta rivista per la firma', OFFERTA_FIRMATA: 'Offerta economica firmata',
  CONTRATTO_PARTNER: 'Contratto al partner', BENVENUTO_PARTNER: 'Credenziali e benvenuto al partner', CONFERMA_PP: 'Contratto firmato (interna)', AVVIO_PP: 'Avvio al laboratorio',
  DOTAZIONE_PP: 'Dotazione', FONDO_CASSA_PP: 'Fondo cassa e POS', RIFIUTI_PP: 'Rifiuti speciali', PRIMO_ORDINE: 'Primo ordine standard',
  CREDENZIALI: 'a) Credenziali al partner', CONFERMA: 'b) Conferma interna', AVVIO_LAB: 'c) Avvio al laboratorio', DOTAZIONE: 'e) Dotazione', FONDO_CASSA: 'f) Fondo cassa e POS', RIFIUTI: 'g) Rifiuti speciali' };
// Punti Prelievo: tipo del punto e stato dei passi dell'avvio
export const TIPO_PUNTO = { FLAGSHIP: { label: 'Flagship', tone: 'blue', long: 'Flagship (sede TD in locazione o di proprietà)' }, CORNER: { label: 'Corner', tone: 'teal', long: 'Corner (sede del partner ospitante)' } };
export const STATO_PASSO = { OK: { label: 'fatto', tone: 'green' }, FALLITO: { label: 'non riuscito', tone: 'red' }, ATTESA_DATA: { label: 'in attesa della data', tone: 'mauve' }, ATTESA_SEDE: { label: 'in attesa della sede', tone: 'mauve' }, DA_FARE: { label: 'da fare', tone: 'grey' }, NON_PREVISTO: { label: 'non previsto', tone: 'grey' } };
export const TONO_ATTIVITA = (t) => (t === 'SISTEMA' ? 'grey' : t === 'CRITICITA' ? 'red' : t.startsWith('EMAIL') ? 'teal' : ['PACCHETTO', 'KIT', 'OFFERTA_ECONOMICA', 'LISTINO'].includes(t) ? 'mauve' : ['CONTRATTO_FIRMATO', 'ATTIVAZIONE', 'FORM_B2B', 'AVVIO'].includes(t) ? 'green' : 'blue');
export const ORIGINE_CRITICITA = { LABORATORIO: 'Laboratorio', CLIENTE: 'Cliente', LOGISTICA: 'Logistica', AMMINISTRAZIONE: 'Amministrazione', ALTRO: 'Altro' };
export const GRAVITA = { BASSA: { label: 'Bassa', tone: 'grey' }, MEDIA: { label: 'Media', tone: 'blue' }, ALTA: { label: 'Alta', tone: 'mauve' }, CRITICA: { label: 'Critica', tone: 'red' } };
export const NC_STATO = { APERTA: 'Aperta', INVIATA_SEDE: 'Inviata alla sede', RISPOSTA_SEDE: 'Risposta della sede', IN_TRATTAMENTO: 'In trattamento', CHIUSA: 'Chiusa', VERIFICATA: 'Verificata', ANNULLATA: 'Annullata' };
export const ORDINE_STATO = { INVIATO: 'Inviato, da approvare', APPROVATO: 'Approvato', PRESO_IN_CARICO: 'Preso in carico', SPEDITO: 'Spedito', CONSEGNATO: 'Consegnato', IMMAGAZZINATO: 'Immagazzinato', CHIUSO: 'Chiuso', ANNULLATO: 'Annullato' };
export const EMAIL_STATO = { INVIATO: { label: 'Inviato', tone: 'green' }, REGISTRATO: { label: 'Registrato (posta in modalità registro)', tone: 'blue' }, FALLITO: { label: 'Fallito', tone: 'red' }, RICEVUTO: { label: 'Ricevuto', tone: 'teal' } };
export const eurK = (n) => (n == null || n === '' ? '–' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, useGrouping: 'always' }).format(Number(n)));
export const pctSconto = (n) => (n == null || n === '' ? '–' : `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 }).format(Number(n) * 100)}%`);
export const giorni = (n) => (n == null ? '–' : `${n} gg`);

// Vocabolari dei Dati commerciali (07/11/2026, il CEO: "non schema libero ma tendine, tutto standardizzato"). Valori presi dal DB
// Opportunità B2B; un valore importato fuori elenco resta selezionabile come "(valore importato)" finché non viene ricondotto.
export const VOCABOLARI = {
  tipologia: ['Laboratorio Analisi', 'Laboratorio Analisi (punto prelievi)', 'Centro Diagnostico', 'Centro Medico', 'Poliambulatorio', 'Studio Medico', 'Casa di Cura', 'Ospedale Privato', 'RSA', 'Centro Fisioterapico', 'Gruppo Sanitario', 'Onlus / Associazione', 'Istituzione', 'Sport / Fitness', 'Azienda (medicina del lavoro)', 'Altro'],
  segmento_lab: ['Laboratori esterni / Anatomia Pat.', 'Centri Diagnostici', 'Poliambulatori / Centri Medici', 'Studi Medici Privati', 'Cliniche / Case di Cura', 'RSA / Residenziale', 'Centri Fisioterapici', 'Onlus / Associazioni', 'Sport / Fitness', 'Forze Armate / Istituzioni', 'Aziende'],
  accreditata_ssr: ['Sì', 'No', 'n.d.'],
  fornitore_attuale: ['n.d.', 'Toscana Diagnostica', 'Synlab', 'Bianalisi', 'CERBA', 'Fanfani', 'PAIM', 'Lifebrain', 'Laboratorio interno', 'Altro'],
  situazione_fornitore: ['Da rilevare', 'In uscita dal fornitore (opportunità)', 'Incumbent da scalzare', 'Contratto TD in essere', 'Cliente TD attivo', 'Non interessato'],
  listino_riferimento: ['Offerta dedicata', 'Offerta di Gruppo', 'Listino standard'],
  modalita_contatto: ['Diretta', 'Tramite gruppo / ente gestore', 'Segnalazione', 'Gara / bando', 'Richiesta del cliente'],
  fonte_priorita: ['Suggerita (regola tipologia)', 'Assegnata', 'Assegnata (Foglio2)'],
  stato_cartella: ['Da contattare', 'Da inviare', 'Inviati', 'Non inviare'],
  anno_bilancio: Array.from({ length: 6 }, (_, i) => String(new Date().getFullYear() - i)),
};
// Discipline: scelta multipla, salvate come elenco separato da virgola
export const DISCIPLINE = ['analisi cliniche', 'prelievi', 'anatomia patologica', 'diagnostica per immagini', 'specialistica ambulatoriale', 'polispecialistica', 'fisioterapia, riabilitazione', 'medicina dello sport', 'medicina del lavoro', 'medicina estetica', 'chirurgia', 'ortopedia', 'psichiatria', 'lungodegenza', 'residenziale anziani', 'residenziale anziani non autosufficienti', 'centro diurno', 'disabilità'];
