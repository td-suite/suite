// Configurazione del modulo Facility e Manutenzioni (variabili d'ambiente con prefisso FACILITY_, tutte facoltative)
const env = process.env;

export const KEY = 'facility';
export const MB = 1024 * 1024;

export const config = {
  appName: 'Facility e Manutenzioni',
  // documenti dell'immobile, rapportini, foto delle segnalazioni: fino a 25 MB l'uno, 10 file per caricamento
  maxFileBytes: Number(env.FACILITY_MAX_FILE_MB || 25) * MB,
  maxFilesPerUpload: Number(env.FACILITY_MAX_FILES || 10),
  // job delle scadenze (minuti): giornaliero
  jobMinutes: Number(env.FACILITY_JOB_MINUTES || 1440),
  // analisi dei consumi simulata senza chiave Anthropic (solo fuori produzione)
  aiMock: env.FACILITY_AI_MOCK === '1' && env.NODE_ENV !== 'production',
};

// Benchmark indicativi (da confermare: fonti generiche "letteratura di settore / ENEA", fattori nazionali medi)
// Fattori di emissione in kgCO2 per unità del vettore: elettrico rete Italia ~0,26 kgCO2/kWh, gas naturale ~1,98 kgCO2/Smc,
// gasolio ~2,65 kgCO2/l, teleriscaldamento ~0,20 kgCO2/kWh (dipende dalla rete), acqua 0 (non energetico).
export const CO2_DEFAULT = { ELETTRICO: 0.26, GAS: 1.98, GASOLIO: 2.65, TELERISCALDAMENTO: 0.2, ACQUA: 0, ALTRO: 0 };
// Conversione in kWh equivalenti per gli indicatori di intensità energetica: gas 10,69 kWh/Smc (potere calorifico superiore
// convenzionale delle bollette), gasolio ~10 kWh/l; l'acqua non è energia.
export const KWH_FACTOR = { ELETTRICO: 1, TELERISCALDAMENTO: 1, GAS: 10.69, GASOLIO: 10, ACQUA: 0, ALTRO: 0 };
export const UNIT_DEFAULT = { ELETTRICO: 'kWh', GAS: 'Smc', ACQUA: 'm3', TELERISCALDAMENTO: 'kWh', GASOLIO: 'l', ALTRO: '' };
export const VECTORS = ['ELETTRICO', 'GAS', 'ACQUA', 'TELERISCALDAMENTO', 'GASOLIO', 'ALTRO'];
// Utenze di Payments (finance.utilities.kind) che portano consumi: corrispondenza con il vettore Facility
export const KIND_TO_VECTOR = { ENERGIA: 'ELETTRICO', GAS: 'GAS', ACQUA: 'ACQUA' };
export const VECTOR_TO_KIND = { ELETTRICO: 'ENERGIA', GAS: 'GAS', ACQUA: 'ACQUA', TELERISCALDAMENTO: 'ALTRO', GASOLIO: 'ALTRO', ALTRO: 'ALTRO' };
export const ENERGY_KINDS = ['ENERGIA', 'GAS', 'ACQUA', 'ALTRO'];

// Fasce indicative di intensità energetica (kWh equivalenti per m2 e anno) per tipologia di sede: ampie, da tarare sui dati reali
// della rete. Fonte generica: letteratura di settore / ENEA per strutture sanitarie non ospedaliere. Non sono limiti normativi.
export const BENCHMARK_KWH_M2 = {
  PUNTO_PRELIEVI: { min: 60, max: 200, label: 'Punti prelievo e ambulatori' },
  CENTRO_MEDICO: { min: 80, max: 250, label: 'Centri medici e poliambulatori' },
  POLIAMBULATORIO: { min: 80, max: 250, label: 'Centri medici e poliambulatori' },
  CENTRO_DIAGNOSTICO: { min: 120, max: 400, label: 'Diagnostica per immagini' },
  LABORATORIO: { min: 150, max: 500, label: 'Laboratori di analisi' },
  HEADQUARTER: { min: 50, max: 180, label: 'Uffici' },
  ALTRO: { min: 60, max: 250, label: 'Altro' },
};
export const BENCHMARK_SOURCE = 'Fasce indicative da letteratura di settore / ENEA per strutture sanitarie non ospedaliere: vanno tarate sui consumi reali della rete; non sono limiti normativi.';

// Impostazioni del modulo (facility.app_settings) con i valori predefiniti
export const SETTINGS_DEFAULT = {
  sla_hours: { URGENTE: 24, ALTA: 72, MEDIA: 240, BASSA: 720 },   // benchmark da confermare: 24 ore, 3, 10, 30 giorni
  co2_factors: CO2_DEFAULT,
  kwh_factors: KWH_FACTOR,
  reminder_days: [30, 7, 0],
  anomaly_pct: 20,                 // mese oltre +20% rispetto allo stesso mese dell'anno prima o alla media mobile di 3 mesi
  activity_source: 'AUTO',         // AUTO (Retail, poi Cash, poi manuale) | RETAIL | CASH | MANUALE
  notify_site_managers: true,
};

export const TENURE = { PROPRIETA: 'Proprietà', LOCAZIONE: 'Locazione', COMODATO: 'Comodato', OSPITATA: 'Ospitata da Legal entity' };
// La planimetria non è un documento dell'immobile: sta nell'anagrafica Sedi (public.site_documents, lib/roomPlan.js)
export const DOC_KINDS = { CONTRATTO: 'Contratto', CERTIFICAZIONE: 'Certificazione', VERBALE: 'Verbale', ALTRO: 'Altro' };
export const OBLIGATION_KINDS = { CONTRATTUALE: 'Contrattuale', NORMATIVO: 'Normativo', ASSICURATIVO: 'Assicurativo' };
export const PLAN_KINDS = { CONTROLLO: 'Controllo', MANUTENZIONE: 'Manutenzione', VERIFICA_NORMATIVA: 'Verifica normativa', COLLAUDO: 'Collaudo' };
export const PLAN_STATUS = { PIANIFICATA: 'Pianificata', ESEGUITA: 'Eseguita', SCADUTA: 'Scaduta', ANNULLATA: 'Annullata' };
export const OUTCOMES = { CONFORME: 'Conforme', NON_CONFORME: 'Non conforme', CON_PRESCRIZIONI: 'Con prescrizioni' };
export const STREAMS = { SORVEGLIANZA: 'Sorveglianza di sede', CONTROLLO: 'Controllo periodico', MANUTENZIONE: 'Manutenzione', OBBLIGO: 'Obbligo dell\'immobile' };
export const WO_STATUS = { APERTO: 'Aperto', ASSEGNATO: 'Assegnato', IN_CORSO: 'In corso', SOSPESO: 'Sospeso', CHIUSO: 'Chiuso' };
export const PRIORITIES = { URGENTE: 'Urgente', ALTA: 'Alta', MEDIA: 'Media', BASSA: 'Bassa' };
export const ASSET_STATUS = { IN_SERVIZIO: 'In servizio', FUORI_SERVIZIO: 'Fuori servizio', DISMESSO: 'Dismesso' };
