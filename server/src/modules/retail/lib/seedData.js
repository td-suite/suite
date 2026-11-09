// Dati di base caricati al primo avvio (modificabili poi dall'applicazione)

export const DEFAULT_SETTINGS = {
  company_name: 'Toscana Diagnostica S.r.l.',
  company_website: 'www.toscanadiagnostica.it',
  brand_claim: 'Ci prendiamo cura del tuo tempo, lì dove ogni minuto conta.',
  fiscal_year_start_month: '1',
  age_bands: '0-17,18-29,30-44,45-59,60-74,75+',
  returning_days: '365',          // un cliente è "di ritorno" se ha una seconda accettazione entro N giorni
  churn_days: '540',              // oltre N giorni dall'ultima visita = cliente dormiente
  top_products_limit: '15',
  exposure_check_days: '30',      // frequenza attesa delle verifiche in sede
  promo_change_day: '1',          // giorno del mese entro cui i materiali devono essere sostituiti
  synclab_privati_in_b2c: 'true', // accettazioni Synclab dei punti TD nel B2C ("Laboratorio in sede"); false = tutto Synclab è B2B (v0.68.0)
};

export const PRODUCT_LINES = [
  { code: 'LAB', name: 'Laboratorio di Analisi', color: '#1C505E', sort_order: 10 },
  { code: 'IMG', name: 'Diagnostica per Immagini', color: '#71B1BD', sort_order: 20 },
  { code: 'SPEC', name: 'Medicina Specialistica', color: '#DEC0F1', sort_order: 30 },
  { code: 'MDL', name: 'Medicina del Lavoro', color: '#2f7d5b', sort_order: 40 },
  { code: 'PAC', name: 'Pacchetti e check-up', color: '#e0b84a', sort_order: 50 },
];

// C6 (programma anagrafica unica, 08/11/2026): tolto l'elenco fisso delle sedi (SITES, con la sede di Viale Belfiore): le sedi sono
// solo quelle di Amministrazione > Sedi (retail.sites_v).

export const EXPOSURE_ZONES = [
  { code: 'ESTERNO', name: 'Esterno e insegna', description: 'Facciata, insegna, vetrofanie, totem esterno', sort_order: 10 },
  { code: 'VETRINA', name: 'Vetrina', description: 'Comunicazione verso la strada: promo del mese, servizi, orari', sort_order: 20 },
  { code: 'INGRESSO', name: 'Ingresso', description: 'Primo contatto: welcome, totem, espositore brochure', sort_order: 30 },
  { code: 'ACCETTAZIONE', name: 'Banco accettazione', description: 'Punto di conversione: cavalieri, QR prenotazione, upsell', sort_order: 40 },
  { code: 'ATTESA', name: 'Sala di attesa', description: 'Tempo di attesa: monitor, poster, leaflet, questionario', sort_order: 50 },
  { code: 'CORRIDOIO', name: 'Corridoi e ambulatori', description: 'Comunicazione di servizio e cross-selling per specialità', sort_order: 60 },
  { code: 'BOX', name: 'Box prelievo', description: 'Messaggio breve: richiami periodici, check-up', sort_order: 70 },
  { code: 'DIGITAL', name: 'Digitale in sede', description: 'Monitor, totem touch, QR, wifi landing', sort_order: 80 },
];

// Standard espositivo (book tipo) per tipologia di sede
export const EXPOSURE_STANDARDS = [
  ['TUTTE', 'ESTERNO', 'Insegna a marchio Toscana Diagnostica', 'secondo manuale', 1, 'Conforme al brand book; illuminata nelle ore di apertura', true],
  ['TUTTE', 'ESTERNO', 'Vetrofania orari e servizi', 'adesivo', 1, 'Aggiornata entro 7 giorni da ogni variazione di orario', true],
  ['TUTTE', 'VETRINA', 'Locandina promo del mese', '70x100 o A3', 1, 'Sostituita entro il giorno 1 di ogni mese', true],
  ['TUTTE', 'INGRESSO', 'Espositore brochure servizi', 'da terra o parete', 1, 'Almeno 3 brochure: laboratorio, imaging, specialistica', true],
  ['TUTTE', 'ACCETTAZIONE', 'Cavaliere da banco promo del mese', 'A5', 2, 'Uno per postazione di accettazione', true],
  ['TUTTE', 'ACCETTAZIONE', 'QR prenotazione online (TuoTempo)', 'A6', 1, 'Visibile dal paziente in piedi', true],
  ['TUTTE', 'ATTESA', 'Poster istituzionale "Ci prendiamo cura del tuo tempo"', 'A2', 1, 'Altezza occhi, parete principale', true],
  ['TUTTE', 'ATTESA', 'Leaflet pacchetti prevenzione', 'A5 in espositore', 1, 'Rifornire quando sotto 20 copie', true],
  ['TUTTE', 'BOX', 'Card richiamo esami periodici', 'A6', 1, 'Consegnata al paziente al prelievo', false],
  ['CENTRO_DIAGNOSTICO', 'ATTESA', 'Monitor palinsesto comunicazione', '43" o superiore', 1, 'Palinsesto aggiornato mensilmente con promo e servizi', true],
  ['CENTRO_DIAGNOSTICO', 'CORRIDOIO', 'Pannelli specialità (RM, TC, Mammografia)', 'A2', 3, 'Uno per area diagnostica', true],
  ['CENTRO_DIAGNOSTICO', 'DIGITAL', 'Totem touch catalogo e prenotazione', 'totem 32"', 1, 'Acceso in orario di apertura', false],
  ['POLIAMBULATORIO', 'ATTESA', 'Monitor palinsesto comunicazione', '43" o superiore', 1, 'Palinsesto aggiornato mensilmente', true],
  ['POLIAMBULATORIO', 'CORRIDOIO', 'Targhe specialisti e orari ambulatori', 'A4', 1, 'Una per ambulatorio, aggiornata ad ogni variazione', true],
  ['POLIAMBULATORIO', 'CORRIDOIO', 'Poster cross-selling specialistica', 'A2', 2, 'Visite e pacchetti correlati alla specialità dell\'ambulatorio', false],
  ['PUNTO_PRELIEVI', 'ATTESA', 'Poster "Dal prelievo al referto" (tempi e app)', 'A2', 1, 'Spiega referto online e tempi di consegna', true],
  ['PUNTO_PRELIEVI', 'ACCETTAZIONE', 'Cavaliere pacchetti check-up laboratorio', 'A5', 1, 'Promuove i profili (base, donna, uomo, sportivo)', true],
  ['LABORATORIO', 'INGRESSO', 'Pannello istituzionale laboratorio e certificazioni', 'A1', 1, 'Accreditamento e qualità', true],
];

export const CONNECTORS = [
  { kind: 'GIPO', base_url: '', auth_kind: 'API_KEY', settings: { note: 'GIPO (Docplanner): export accettazioni e pazienti. Senza API pubblica: usare export CSV/Excel periodico o richiedere al fornitore le credenziali di integrazione.' } },
  { kind: 'TUOTEMPO', base_url: 'https://app.tuotempo.com/api/v3', auth_kind: 'BASIC', settings: { instance: '', note: 'TuoTempo (Docplanner) espone API REST v3: prenotazioni, pazienti, disponibilità. Servono dbName dell\'istanza e credenziali API fornite da Docplanner.' } },
  { kind: 'STUDIOLAB', base_url: '', auth_kind: 'SFTP', settings: { note: 'StudioLab (CB Sistemi): accettazioni B2B. Integrazione via export schedulato (CSV su SFTP o cartella condivisa) o web service se attivato da CB Sistemi.' } },
];
