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
};

export const PRODUCT_LINES = [
  { code: 'LAB', name: 'Laboratorio di Analisi', color: '#1C505E', sort_order: 10 },
  { code: 'IMG', name: 'Diagnostica per Immagini', color: '#71B1BD', sort_order: 20 },
  { code: 'SPEC', name: 'Medicina Specialistica', color: '#DEC0F1', sort_order: 30 },
  { code: 'MDL', name: 'Medicina del Lavoro', color: '#2f7d5b', sort_order: 40 },
  { code: 'PAC', name: 'Pacchetti e check-up', color: '#e0b84a', sort_order: 50 },
];

// Sedi attive (da "Sedi Attive - TD.xlsx", aprile 2026)
export const SITES = [
  { code: 'FI-HQ', name: 'Firenze · Viale Belfiore (sede)', kind: 'HEADQUARTER', address: 'Viale Belfiore, 55', city: 'Firenze', province: 'FI', zip: '50144', manager: 'Francesco Epifani', legacy_brand: 'Toscana Diagnostica', lat: 43.7836, lng: 11.2376 },
  { code: 'SF-LAB', name: 'Sesto Fiorentino · Laboratorio Pratignone', kind: 'LABORATORIO', address: 'Via di Pratignone, 13/4', city: 'Sesto Fiorentino', province: 'FI', zip: '50019', manager: 'Valentina Zezza', legacy_brand: 'Toscana Diagnostica', lat: 43.8205, lng: 11.1850 },
  { code: 'FI-CEC', name: 'Firenze · Via Cecioni', kind: 'CENTRO_DIAGNOSTICO', address: 'Via Adriano Cecioni, 86', city: 'Firenze', province: 'FI', zip: '50142', manager: 'Eva Alderighi', legacy_brand: 'Toscana Diagnostica', lat: 43.7735, lng: 11.2110 },
  { code: 'PC-MOR', name: 'Poggio a Caiano · Viale Aldo Moro', kind: 'CENTRO_DIAGNOSTICO', address: 'Viale Aldo Moro, 18/20', city: 'Poggio a Caiano', province: 'PO', zip: '59016', manager: null, legacy_brand: 'Toscana Diagnostica', lat: 43.8135, lng: 11.0545 },
  { code: 'SF-RAG', name: 'Sesto Fiorentino · Istituto Ragionieri', kind: 'POLIAMBULATORIO', address: 'Via dei Colatori, 10/A', city: 'Sesto Fiorentino', province: 'FI', zip: '50019', manager: null, legacy_brand: 'Istituto Ragionieri', lat: 43.8300, lng: 11.1990 },
  { code: 'SF-COL', name: 'Sesto Fiorentino · Via dei Colatori 7', kind: 'CENTRO_DIAGNOSTICO', address: 'Via dei Colatori, 7', city: 'Sesto Fiorentino', province: 'FI', zip: '50019', manager: null, legacy_brand: 'Toscana Diagnostica', lat: 43.8298, lng: 11.1985 },
  { code: 'FI-CIFS', name: 'Firenze · CIFS Via della Fortezza', kind: 'POLIAMBULATORIO', address: 'Via della Fortezza, 6', city: 'Firenze', province: 'FI', zip: '50129', manager: 'Sandra Pellegrino', legacy_brand: 'CIFS', lat: 43.7805, lng: 11.2500 },
  { code: 'FI-COR', name: 'Firenze · COR Via Giano della Bella', kind: 'POLIAMBULATORIO', address: 'Via Giano della Bella, 6', city: 'Firenze', province: 'FI', zip: '50124', manager: 'Francesco Nardi', legacy_brand: 'COR Firenze', lat: 43.7650, lng: 11.2350 },
  { code: 'BSL-BIO', name: 'Borgo San Lorenzo · Bioscienze', kind: 'CENTRO_DIAGNOSTICO', address: 'Piazza Martin Luther King', city: 'Borgo San Lorenzo', province: 'FI', zip: '50032', manager: 'Riccardo Gabellini', legacy_brand: 'Bioscienze', lat: 43.9550, lng: 11.3860 },
  { code: 'MM-PP', name: 'Montemurlo · Punto prelievi', kind: 'PUNTO_PRELIEVI', address: 'Via Montalese, 653', city: 'Montemurlo', province: 'PO', zip: '59013', manager: 'Piera Mucci', legacy_brand: 'Toscana Diagnostica', lat: 43.9270, lng: 11.0350 },
  { code: 'QU-PP', name: 'Quarrata · Punto prelievi', kind: 'PUNTO_PRELIEVI', address: 'Via della Repubblica, 88/C', city: 'Quarrata', province: 'PT', zip: '51039', manager: 'Lorenzo Gucci', legacy_brand: 'Toscana Diagnostica', lat: 43.8470, lng: 10.9800 },
  { code: 'CA-PP', name: 'Calenzano · Punto prelievi', kind: 'PUNTO_PRELIEVI', address: 'Via di Prato, 26', city: 'Calenzano', province: 'FI', zip: '50041', manager: 'Manuela Gelli', legacy_brand: 'Toscana Diagnostica', lat: 43.8650, lng: 11.1650 },
  { code: 'CB-POL', name: 'Campi Bisenzio · Via Buozzi', kind: 'POLIAMBULATORIO', address: 'Via Bruno Buozzi, 27', city: 'Campi Bisenzio', province: 'FI', zip: '50013', manager: 'Sara Baldacci', legacy_brand: 'Toscana Diagnostica', lat: 43.8200, lng: 11.1350 },
  { code: 'LI-LAM', name: 'Livorno · Labronica Via Lampredi', kind: 'PUNTO_PRELIEVI', address: 'Via Aurelio Lampredi, 3', city: 'Livorno', province: 'LI', zip: '57121', manager: 'Sara Baldacci', legacy_brand: 'Labronica', lat: 43.5520, lng: 10.3150 },
  { code: 'LI-FOL', name: 'Livorno · Biolabor Folgore', kind: 'POLIAMBULATORIO', address: 'Piazzale 185° Reggimento Artiglieria Folgore, 1', city: 'Livorno', province: 'LI', zip: '57128', manager: 'Sara Baldacci', legacy_brand: 'Biolabor', lat: 43.5300, lng: 10.3200 },
  { code: 'LI-MAR', name: 'Livorno · Biolabor Via March', kind: 'POLIAMBULATORIO', address: 'Via Giovanni March, 20', city: 'Livorno', province: 'LI', zip: '57121', manager: 'Sara Baldacci', legacy_brand: 'Biolabor', lat: 43.5480, lng: 10.3180 },
  { code: 'LI-ROM', name: 'Livorno · Biolabor Via Roma', kind: 'PUNTO_PRELIEVI', address: 'Via Roma, 51', city: 'Livorno', province: 'LI', zip: '57125', manager: 'Sara Baldacci', legacy_brand: 'Biolabor', lat: 43.5440, lng: 10.3120 },
  { code: 'LI-MON', name: 'Livorno · Biolabor Montenero', kind: 'PUNTO_PRELIEVI', address: 'Via di Montenero, 201', city: 'Livorno', province: 'LI', zip: '57128', manager: 'Sara Baldacci', legacy_brand: 'Biolabor', lat: 43.5150, lng: 10.3350 },
  { code: 'LI-MTL', name: 'Livorno · Biolabor Piazzale Montello', kind: 'PUNTO_PRELIEVI', address: 'Piazzale Montello, 12/A', city: 'Livorno', province: 'LI', zip: '57128', manager: 'Sara Baldacci', legacy_brand: 'Biolabor', lat: 43.5330, lng: 10.3230 },
  { code: 'RS-POL', name: 'Rosignano Solvay · Biolabor', kind: 'POLIAMBULATORIO', address: "Via dell'Energia", city: 'Rosignano Solvay', province: 'LI', zip: '57016', manager: 'Sara Baldacci', legacy_brand: 'Biolabor', lat: 43.3900, lng: 10.4300 },
  { code: 'FI-PAO', name: 'Firenze · Viale Paoli', kind: 'CENTRO_DIAGNOSTICO', address: 'Viale Paoli, 6', city: 'Firenze', province: 'FI', zip: '50137', manager: null, legacy_brand: 'Toscana Diagnostica', lat: 43.7820, lng: 11.2810 },
];

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
