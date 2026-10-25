// Dati di base caricati al primo avvio (idempotenti)

// Tecnostruttura (funzioni di staff): in alto nell'organigramma; le altre aree sono operative (pettine)
export const STAFF_AREAS = ['Operations', 'Finance', 'Legal, People and Organization', 'Flow & Back Office Management', 'Retail & Communications Management', 'HSQ Management', 'Direzione Sanitaria', 'Lab Operations Management'];

export const AREAS = [ // dall'organigramma TD-SGI-IDL007_01 Allegato 1: [nome, area di livello superiore]
  ['Direzione Generale', null],
  ['Operations', 'Direzione Generale'],
  ['Finance', 'Direzione Generale'],
  ['Legal, People and Organization', 'Direzione Generale'],
  ['Flow & Back Office Management', 'Direzione Generale'],
  ['Retail & Communications Management', 'Direzione Generale'],
  ['HSQ Management', 'Direzione Generale'],
  ['Direzione Sanitaria', 'Direzione Generale'],
  ['Laboratorio di Analisi', 'Direzione Generale'],
  ['Direzione Tecnica', 'Laboratorio di Analisi'],
  ['Lab Operations Management', 'Direzione Tecnica'],
  ['Preanalitica', 'Direzione Tecnica'],
  ['Core Lab', 'Direzione Tecnica'],
  ['Microbiologia', 'Direzione Tecnica'],
  ['Biologia Molecolare', 'Direzione Tecnica'],
  ['Anatomia Patologica', 'Direzione Tecnica'],
  ['Network Punti Prelievo', 'Direzione Generale'],
  ['B2B', 'Direzione Generale'],
  ['Diagnostic Center', 'Direzione Generale'],
];

export const WORK_SITES = [
  { name: 'Sede operativa Sesto Fiorentino', address: 'via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI)' },
  { name: 'Sede Firenze Belfiore', address: 'viale Belfiore, 55, 50144 Firenze (FI)' },
  { name: 'Sede Livorno', address: 'Via Aurelio Lampredi, 3, 57121 Livorno (LI)' },
];

export const DEFAULT_SETTINGS = {
  company_name: 'Toscana Diagnostica S.r.l.',
  company_address: 'Via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI)',
  company_legal_address: 'Viale Belfiore, 55, 50144, Firenze (FI)',
  company_vat: '07528130482',
  company_rea: 'FI-709602',
  company_capital: '€ 50.000,00 i.v.',
  company_phone: '055776511',
  company_email: 'info@toscanadiagnostica.it',
  company_pec: 'toscanadiagnostica@pec.it',
  company_website: 'www.toscanadiagnostica.it',
  health_director: 'prof. Gian Luigi Taddei',
  signatory_name: 'Francesco Epifani',
  signatory_title: 'Amministratore Delegato',
  board_signatory_name: 'Valentina Zezza',            // firma i contratti del CEO (Consigliere di Amministrazione)
  board_signatory_title: 'Un Consigliere di Amministrazione',
  dirigenti_minimum: '85000.00',                       // CCNL Dirigenti Industria: trattamento minimo complessivo di garanzia (TMCG) annuo
  dirigenti_monthly_payments: '13',
  letter_city: 'Firenze',
  // Costo azienda (ipotesi configurabili: verificare con il consulente del lavoro)
  cost_inps_pct: '29.00',
  cost_inail_pct: '0.50',
  cost_tfr_pct: '6.91',
  cost_apprentice_inps_pct: '11.61',
  cost_dirigente_extra_pct: '8.00',
  // Simulatore busta paga (stime)
  irpef_brackets: JSON.stringify([{ upTo: 28000, rate: 23 }, { upTo: 50000, rate: 35 }, { upTo: null, rate: 43 }]),
  employee_inps_pct: '9.19',
  addizionale_regionale_pct: '1.42',
  addizionale_comunale_pct: '0.30',
  function_allowance_share: '0.70',
  deadline_alert_days: '60',
};

// Minimi tabellari CCNL Studi Professionali (fonte: Elaboratore Buste Paga, Foglio2)
const M = (b, t1, t2, t3, t4, enac) => [
  { from: '2024-02-29', amount: b },
  { from: '2024-03-01', amount: t1 },
  { from: '2024-10-01', amount: t2 },
  { from: '2025-10-01', amount: t3, enac },
  { from: '2026-12-01', amount: t4, enac },
];
export const CCNL_LEVELS = [
  { level: 'Q', description: 'Quadro', probation_days: 180, minimums: M(2133.31, 2281.51, 2345.02, 2408.53, 2436.76, null) },
  { level: '1', description: '1° livello', probation_days: 180, minimums: M(1887.84, 2018.99, 2075.19, 2131.39, 2156.38, 42.35) },
  { level: '2', description: '2° livello', probation_days: 120, minimums: M(1644.37, 1758.60, 1807.55, 1856.50, 1878.26, 102.53) },
  { level: '3S', description: '3° livello Super', probation_days: 120, minimums: M(1525.23, 1631.19, 1676.60, 1722.01, 1742.20, 110.40) },
  { level: '3', description: '3° livello', probation_days: 120, minimums: M(1511.37, 1616.37, 1661.37, 1706.37, 1726.37, null) },
  { level: '4S', description: '4° livello Super', probation_days: 90, minimums: M(1465.62, 1567.44, 1611.07, 1654.70, 1674.10, null) },
  { level: '4', description: '4° livello', probation_days: 90, minimums: M(1413.11, 1511.28, 1553.35, 1595.42, 1614.12, null) },
  { level: '5', description: '5° livello', probation_days: 60, minimums: M(1315.12, 1406.48, 1445.63, 1484.78, 1502.19, null) },
];

export const CCNL_SECTIONS = [
  { title: 'Campo di applicazione e fonti', body: 'Il CCNL per i dipendenti degli studi professionali (Confprofessioni) è il contratto applicato da Toscana Diagnostica S.r.l. a tutto il personale subordinato non dirigente. Il testo integrale, caricato in questa sezione, prevale su ogni sintesi. Il personale dirigente è regolato dal CCNL Dirigenti di aziende produttrici di beni e servizi (Confindustria).' },
  { title: 'Inquadramento e livelli', body: 'I livelli in uso sono Quadro, 1°, 2°, 3° Super, 3°, 4° Super, 4° e 5°. I minimi tabellari mensili per livello, con le tranche di aumento del rinnovo (1/3/2024, 1/10/2024, 1/10/2025, 1/12/2026), sono riportati nella tabella RAL di questa sezione. La retribuzione lorda annua (RAL) indicata nei contratti aziendali è composta da paga base (minimo tabellare), superminimo (assorbibile o non assorbibile) e indennità di funzione, erogata su 14 mensilità.' },
  { title: 'Periodo di prova', body: 'Durata massima del periodo di prova: Quadri e 1° livello 180 giorni di calendario; 2°, 3° Super e 3° livello 120 giorni; 4° Super e 4° livello 90 giorni; 5° livello 60 giorni. Nei contratti aziendali il periodo di prova può essere ridotto o escluso ("Nessuno").' },
  { title: 'Orario di lavoro', body: 'Orario normale di 40 ore settimanali, distribuito di norma su 5 giorni (dal lunedì al venerdì) o su 6 giorni dove previsto dall\'organizzazione del servizio. Per le posizioni con autonomia nella determinazione del tempo di lavoro i contratti richiamano l\'art. 17 del D.Lgs. 66/2003 (esclusione dai limiti massimi dell\'orario).' },
  { title: 'Mensilità aggiuntive', body: 'La retribuzione è corrisposta in 14 mensilità: 12 mensilità ordinarie, tredicesima e quattordicesima. Negli importi mensili dei contratti aziendali la RAL è divisa per 14.' },
  { title: 'Ferie, permessi ROL ed ex festività', body: 'Ferie, permessi retribuiti (ROL) ed ex festività maturano secondo il CCNL. L\'accordo aziendale prevede che ROL ed ex festività non goduti alla fine del periodo di maturazione possano essere fruiti fino alla cessazione del rapporto. Inserire qui i valori numerici del testo contrattuale vigente.' },
  { title: 'Apprendistato professionalizzante', body: 'Disciplinato dagli artt. 41-47 del D.Lgs. 81/2015 e dalla Sezione IV del CCNL: durata massima 30 mesi, periodo di prova 60 giorni di lavoro effettivo, formazione interna non inferiore a 80 ore medie annue oltre alla formazione di base regionale. Retribuzione in percentuale del minimo tabellare del livello di destinazione (85% nel primo periodo, 90% nel secondo, 100% al termine), come nel contratto di apprendistato aziendale.' },
  { title: 'Enti bilaterali e assistenza', body: 'Il CCNL prevede la contribuzione agli enti bilaterali di settore (assistenza sanitaria integrativa, ente bilaterale, fondo per la formazione) e il contributo ENAC per i livelli indicati nella tabella dei minimi. Verificare importi e decorrenze sul testo del CCNL caricato e con il consulente del lavoro.' },
  { title: 'Cessazione e preavviso', body: 'Dimissioni e risoluzione consensuale si comunicano in modalità telematica (D.Lgs. 151/2015, art. 26). I termini di preavviso per livello e anzianità sono quelli del CCNL; le lettere di impegno aziendali prevedono una clausola penale per mancata presa di servizio pari all\'indennità sostitutiva di preavviso.' },
  { title: 'Contratto Collettivo Integrativo Aziendale (CCIA)', body: 'Toscana Diagnostica applica un accordo integrativo aziendale (welfare, flessibilità, maggiorazioni per il presidio del sabato, banca ore, permessi aggiuntivi, scontistica sanitaria per il nucleo familiare). Il testo è caricato tra i documenti CCNL di questa sezione; la sua accettazione è richiamata in ogni lettera di assunzione.' },
];

export const DOSSIER_REQUIREMENTS = [
  // Dipendenti
  { kind: 'DIPENDENTE', category: 'CONTRATTO_FIRMATO', label: 'Contratto di assunzione firmato', required: true, sort_order: 10 },
  { kind: 'DIPENDENTE', category: 'UNILAV', label: 'Comunicazione UNILAV', required: true, sort_order: 20 },
  { kind: 'DIPENDENTE', category: 'CI', label: 'Documento di identità', required: true, renew_months: null, sort_order: 30 },
  { kind: 'DIPENDENTE', category: 'CF', label: 'Codice fiscale / tessera sanitaria', required: true, sort_order: 40 },
  { kind: 'DIPENDENTE', category: 'CV', label: 'Curriculum vitae', required: true, sort_order: 50 },
  { kind: 'DIPENDENTE', category: 'TITOLO_STUDIO', label: 'Titoli di studio', required: true, sort_order: 60 },
  { kind: 'DIPENDENTE', category: 'ALBO', label: 'Iscrizione albo professionale (quota annuale)', required: false, renew_months: 12, sort_order: 70 },
  { kind: 'DIPENDENTE', category: 'DETRAZIONI', label: 'Dichiarazione detrazioni d\'imposta', required: true, renew_months: 12, sort_order: 80 },
  { kind: 'DIPENDENTE', category: 'TFR', label: 'Modulo scelta TFR', required: true, sort_order: 90 },
  { kind: 'DIPENDENTE', category: 'L335', label: 'Dichiarazione L. 335/95 (massimale)', required: true, sort_order: 100 },
  { kind: 'DIPENDENTE', category: 'DATI_BANCARI', label: 'Dati bancari (TD-SGI-MOD078)', required: true, sort_order: 110 },
  { kind: 'DIPENDENTE', category: 'PRIVACY', label: 'Informativa privacy firmata', required: true, sort_order: 120 },
  { kind: 'DIPENDENTE', category: 'POLITICA_SGI', label: 'Politica Integrata SGI firmata', required: true, sort_order: 130 },
  { kind: 'DIPENDENTE', category: 'REGOLAMENTO', label: 'Regolamento Generale Aziendale (TD-SGI-REG004)', required: true, sort_order: 140 },
  { kind: 'DIPENDENTE', category: 'MOD231', label: 'Modello 231, Codice Etico e Codice di Condotta', required: true, sort_order: 150 },
  { kind: 'DIPENDENTE', category: 'SPECIMEN_FIRMA', label: 'Specimen di firma (TD-SGI-MOD032)', required: false, sort_order: 160 },
  { kind: 'DIPENDENTE', category: 'CONSEGNA_DOTAZIONI', label: 'Consegna dotazioni (TD-SGI-MOD030)', required: false, sort_order: 170 },
  { kind: 'DIPENDENTE', category: 'SMART_WORKING', label: 'Accordo smart working', required: false, sort_order: 180 },
  { kind: 'DIPENDENTE', category: 'MBO', label: 'Piano MBO firmato', required: false, renew_months: 12, sort_order: 190 },
  { kind: 'DIPENDENTE', category: 'FORMAZIONE_SICUREZZA', label: 'Formazione sicurezza (D.Lgs. 81/2008)', required: true, renew_months: 60, sort_order: 210 },
  { kind: 'DIPENDENTE', category: 'VISITA_MEDICA', label: 'Idoneità sanitaria (medico competente)', required: false, renew_months: 12, sort_order: 220 },
  { kind: 'DIPENDENTE', category: 'ECM', label: 'Crediti ECM (triennio)', required: false, renew_months: 36, sort_order: 230 },
  { kind: 'DIPENDENTE', category: 'FORMAZIONE', label: 'Attestati di formazione', required: false, sort_order: 240 },
  { kind: 'DIPENDENTE', category: 'LETTERA_IMPEGNO', label: 'Lettera di impegno firmata', required: false, sort_order: 250 },
  { kind: 'DIPENDENTE', category: 'ALTRO', label: 'Altro', required: false, sort_order: 900 },
  // Liberi professionisti
  { kind: 'LP', category: 'CONTRATTO_FIRMATO', label: 'Contratto di prestazione professionale firmato', required: true, sort_order: 10 },
  { kind: 'LP', category: 'CI', label: 'Documento di identità', required: true, sort_order: 20 },
  { kind: 'LP', category: 'CF', label: 'Codice fiscale', required: true, sort_order: 30 },
  { kind: 'LP', category: 'PIVA', label: 'Certificato attribuzione partita IVA', required: true, sort_order: 40 },
  { kind: 'LP', category: 'ALBO', label: 'Iscrizione all\'ordine (anno in corso)', required: true, renew_months: 12, sort_order: 50 },
  { kind: 'LP', category: 'POLIZZA_RC', label: 'Polizza RC professionale', required: true, renew_months: 12, sort_order: 60 },
  { kind: 'LP', category: 'TITOLO_STUDIO', label: 'Titoli di studio e specializzazioni', required: true, sort_order: 70 },
  { kind: 'LP', category: 'CV', label: 'Curriculum vitae', required: true, sort_order: 80 },
  { kind: 'LP', category: 'INCOMPATIBILITA', label: 'Dichiarazione di non incompatibilità (annuale)', required: true, renew_months: 12, sort_order: 90 },
  { kind: 'LP', category: 'MOD231', label: 'Presa visione Modello 231', required: true, sort_order: 100 },
  { kind: 'LP', category: 'PRIVACY', label: 'Informativa privacy', required: true, sort_order: 110 },
  { kind: 'LP', category: 'ECM', label: 'Crediti ECM (triennio)', required: false, renew_months: 36, sort_order: 120 },
  { kind: 'LP', category: 'FORMAZIONE', label: 'Attestati di formazione (BLS, sicurezza)', required: false, sort_order: 130 },
  { kind: 'LP', category: 'ALTRO', label: 'Altro', required: false, sort_order: 900 },
];

export const CATEGORY_LABELS = Object.fromEntries(DOSSIER_REQUIREMENTS.map((r) => [r.category, r.label]));

// Organigramma (TD-SGI-IDL007_01 - Allegato 1, agg. 22/09/2026). Le unità STAFF sono le posizioni "di staff"
// del diagramma originale (C-level a riporto del CEO, Direttore Sanitario e Lab Operations Manager).
// L'asterisco nel documento originale non ha legenda: viene conservato nelle note come "da confermare" (ipotesi).
const DS = (name) => ({ name: 'Direzione Sanitaria', role_title: 'Direttore Sanitario', head_name: name, kind: 'STAFF', area: 'Direzione Sanitaria' });
export const ORG_UNITS = {
  name: 'Direzione Generale', role_title: 'Chief Executive Officer', head_name: 'Francesco Epifani', kind: 'DIREZIONE', area: 'Direzione Generale',
  children: [
    { name: 'Operations', role_title: 'Chief Operating Officer', head_name: 'Valentina Zezza', kind: 'STAFF', area: 'Operations' },
    { name: 'Finance', role_title: 'Chief Financial Officer', head_name: 'Vincenzo Malenchini', kind: 'STAFF', area: 'Finance' },
    { name: 'Legal, People and Organization', role_title: 'Chief of Legal, People and Organization', head_name: 'Angelica Corradi', kind: 'STAFF', area: 'Legal, People and Organization' },
    { name: 'Flow & Back Office Management', role_title: 'Flow & Back Office Manager', head_name: 'Rosetta Greco', kind: 'STAFF', area: 'Flow & Back Office Management' },
    { name: 'Retail & Communications Management', role_title: 'Retail & Communications Manager', head_name: 'Silvia Sansoni', kind: 'STAFF', area: 'Retail & Communications Management' },
    { name: 'HSQ Management', role_title: 'HSQ Manager', head_name: 'Iacopo Cupelli', kind: 'STAFF', area: 'HSQ Management' },
    { name: 'Laboratorio di Analisi', role_title: 'Responsabile Laboratorio di Analisi', head_name: 'Valentina Zezza', kind: 'LINEA', area: 'Laboratorio di Analisi', children: [
      { name: 'Direzione Tecnica', role_title: 'Direttore Tecnico', head_name: 'Maria Teresa Balzano', kind: 'FUNZIONE', area: 'Direzione Tecnica', children: [
        DS('Gian Luigi Taddei'),
        { name: 'Lab Operations Management', role_title: 'Lab Operations Manager', head_name: 'Sara Arrighetti', kind: 'STAFF', area: 'Lab Operations Management' },
        { name: 'Preanalitica', role_title: 'Responsabile Preanalitica', head_name: 'Sara Arrighetti', kind: 'FUNZIONE', area: 'Preanalitica' },
        { name: 'Core Lab', role_title: 'Responsabile Core Lab', head_name: 'Antonia Esposito', kind: 'FUNZIONE', area: 'Core Lab' },
        { name: 'Microbiologia', role_title: 'Responsabile Microbiologia', head_name: 'Chiara Chilleri', kind: 'FUNZIONE', area: 'Microbiologia' },
        { name: 'Biologia Molecolare', role_title: 'Responsabile Biologia Molecolare', head_name: 'Silvia Quattrone', kind: 'FUNZIONE', area: 'Biologia Molecolare' },
        { name: 'Anatomia Patologica', role_title: 'Responsabile Anatomia Patologica', head_name: 'Cristina Fondi', kind: 'FUNZIONE', area: 'Anatomia Patologica', children: [
          { name: 'Anatomia Patologica', role_title: 'Responsabile Tecnico', head_name: 'Stefania Barelli', kind: 'FUNZIONE', area: 'Anatomia Patologica' },
        ] },
      ] },
    ] },
    { name: 'Network Punti Prelievo', role_title: 'Responsabile Network Punti Prelievo', head_name: 'Silvia Sansoni', kind: 'LINEA', area: 'Network Punti Prelievo', children: [
      { name: 'Montemurlo', role_title: 'Referente Punto Prelievo', head_name: 'Piera Mucci', kind: 'SEDE', notes: 'Asterisco nel documento originale: da confermare', children: [DS('Gian Luigi Taddei')] },
      { name: 'Calenzano', role_title: 'Referente Punto Prelievo', head_name: 'Manuela Gelli', kind: 'SEDE', children: [DS('Gian Luigi Taddei')] },
      { name: 'Quarrata', role_title: 'Referente Punto Prelievo', head_name: 'Lorenzo Gucci', kind: 'SEDE', notes: 'Asterisco nel documento originale: da confermare', children: [DS('Gian Luigi Taddei')] },
      { name: 'Livorno, Labronica', role_title: 'Referente Punto Prelievo', head_name: 'Milena Monti', kind: 'SEDE', children: [DS('Gian Luigi Taddei')] },
      { name: 'Livorno, Carducci', role_title: 'Referente Punto Prelievo', kind: 'SEDE', tbd: true, children: [DS('Gian Luigi Taddei')] },
      { name: 'Livorno, Banditella', role_title: 'Referente Punto Prelievo', kind: 'SEDE', tbd: true, children: [DS('Gian Luigi Taddei')] },
      { name: 'Livorno, Picchianti', role_title: 'Referente Punto Prelievo', kind: 'SEDE', tbd: true, children: [DS('Gian Luigi Taddei')] },
      { name: 'Livorno, Centro', role_title: 'Referente Punto Prelievo', kind: 'SEDE', tbd: true, children: [DS('Gian Luigi Taddei')] },
      { name: 'Livorno, Montenero', role_title: 'Referente Punto Prelievo', kind: 'SEDE', tbd: true, children: [DS('Gian Luigi Taddei')] },
    ] },
    { name: 'B2B', role_title: 'Responsabile B2B', head_name: 'Valentina Cesati', kind: 'LINEA', area: 'B2B' },
    { name: 'Diagnostic Center', role_title: 'Responsabile Diagnostic Center', head_name: 'Rosetta Greco', kind: 'LINEA', area: 'Diagnostic Center', children: [
      { name: 'Centro Diagnostico Firenze', role_title: 'Referente di sede', kind: 'SEDE', tbd: true, notes: 'Asterisco nel documento originale: da confermare', children: [DS('Vincenzo Cupelli')] },
      { name: 'Centro Diagnostico Firenze CIFS', role_title: 'Referente di sede', head_name: 'Angela De Marco', kind: 'SEDE', children: [DS('Oreste Saltarelli')] },
      { name: 'Centro Medico Borgo San Lorenzo', role_title: 'Referente di sede', head_name: 'Riccardo Gabellini', kind: 'SEDE', children: [DS('Roberto Gastaldi')] },
      { name: 'Centro Medico Livorno March', role_title: 'Referente di sede', kind: 'SEDE', tbd: true, children: [DS('Alessandro Chiaverini')] },
      { name: 'Centro Medico Rosignano', role_title: 'Referente di sede', kind: 'SEDE', tbd: true, children: [DS('Alessandro Chiaverini')] },
      { name: 'Centro Medico Livorno Centro', role_title: 'Referente di sede', kind: 'SEDE', tbd: true, children: [DS('Alessandro Chiaverini')] },
    ] },
  ],
};
