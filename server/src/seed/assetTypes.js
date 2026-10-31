// Seed del Catalogo dispositivi (public.asset_types, Amministrazione > Anagrafiche > Catalogo dispositivi). Richiesta del CEO del
// 31/10/2026: dispositivi sotto manutenzione, compresi quelli di sicurezza. BENCHMARK INDICATIVO, DA CONFERMARE CON RSPP E QUALITÀ:
// periodicità e riferimenti sono quelli di uso comune nel settore; dove la periodicità dipende dal tipo, dalla carica o dal fabbricante
// la nota lo dice. Le norme sono citate senza articoli quando non serve precisione: prima dell'uso vanno verificate sulla versione
// vigente. Si semina una volta sola (app_settings 'facility.asset_types_seeded'): da lì in poi il catalogo lo governa Amministrazione.
const NOTA = 'Benchmark indicativo, da confermare con RSPP e Qualità.';
const CLIN = ['PUNTO_PRELIEVI', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'CENTRO_MEDICO', 'LABORATORIO'];
const AMB = ['CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'CENTRO_MEDICO'];
const IMG = ['CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO'];
const LAB = ['LABORATORIO'];

// [code, name, category, surveillance_months, check_interval_months, check_kind, maintenance_interval_months, legal_reference,
//  requires_certified_vendor, applies_to_kinds, description, nota specifica]
const RAW = [
  // ---- Sicurezza antincendio
  ['ESTINTORE_POLVERE', 'Estintore a polvere', 'SICUREZZA_ANTINCENDIO', 1, 6, 'CONTROLLO', 36, 'UNI 9994-1; D.M. 1/9/2021 (controlli e manutenzione degli impianti antincendio)', true, [],
    'Sorveglianza mensile interna (presenza, accessibilità, manometro, sigillo), controllo semestrale da tecnico qualificato, revisione periodica e collaudo del serbatoio secondo il tipo.', 'Revisione e collaudo dipendono dall\'agente estinguente e dalla data di fabbricazione.'],
  ['ESTINTORE_CO2', 'Estintore a CO2', 'SICUREZZA_ANTINCENDIO', 1, 6, 'CONTROLLO', 60, 'UNI 9994-1; D.M. 1/9/2021; normativa sui recipienti a pressione per il collaudo', true, [],
    'Sorveglianza mensile interna, controllo semestrale, revisione e collaudo della bombola alle scadenze di legge.', 'Collaudo della bombola secondo la normativa sui recipienti a pressione.'],
  ['PORTA_REI', 'Porta tagliafuoco REI', 'SICUREZZA_ANTINCENDIO', 1, 6, 'CONTROLLO', null, 'UNI 11473; D.M. 1/9/2021', true, [],
    'Sorveglianza mensile (chiusura, guarnizioni, sgombero), controllo semestrale di chiudiporta, cerniere e dispositivi di trattenuta.', null],
  ['MANIGLIONE_ANTIPANICO', 'Maniglione antipanico', 'SICUREZZA_ANTINCENDIO', 1, 6, 'CONTROLLO', null, 'UNI EN 1125; D.M. 1/9/2021', true, [],
    'Sorveglianza mensile di funzionamento e sgombero dell\'uscita, controllo semestrale da tecnico qualificato.', null],
  ['RILEVAZIONE_FUMI', 'Impianto di rilevazione fumi e allarme incendio', 'SICUREZZA_ANTINCENDIO', null, 6, 'CONTROLLO', 12, 'UNI 11224; UNI 9795; D.M. 1/9/2021', true, [],
    'Controllo semestrale di rivelatori, pulsanti, centrale e segnalatori; manutenzione annuale.', null],
  ['IDRANTI_NASPI', 'Idranti e naspi', 'SICUREZZA_ANTINCENDIO', null, 6, 'CONTROLLO', 12, 'UNI EN 671-3; UNI 10779', true, [],
    'Controllo semestrale con prova di pressione e portata, manutenzione annuale delle tubazioni flessibili.', null],
  ['SPRINKLER', 'Impianto sprinkler (se presente)', 'SICUREZZA_ANTINCENDIO', 1, 6, 'CONTROLLO', 12, 'UNI EN 12845', true, [],
    'Sorveglianza delle valvole e delle pressioni, controllo semestrale, manutenzione annuale.', 'Solo dove l\'impianto è presente.'],
  // ---- Sicurezza dei luoghi
  ['ILLUMINAZIONE_EMERGENZA', 'Illuminazione di emergenza', 'SICUREZZA_LUOGHI', 1, 6, 'CONTROLLO', 12, 'UNI EN 50172; UNI 11222; D.M. 1/9/2021', false, [],
    'Prova funzionale mensile interna, controllo semestrale dell\'autonomia, manutenzione annuale (batterie e lampade).', null],
  ['SEGNALETICA_SICUREZZA', 'Segnaletica di sicurezza e planimetrie di emergenza', 'SICUREZZA_LUOGHI', null, 12, 'CONTROLLO', null, 'D.Lgs. 81/2008 (segnaletica di salute e sicurezza)', false, [],
    'Verifica annuale di presenza, leggibilità e aggiornamento delle planimetrie di esodo.', null],
  ['PROVA_EVACUAZIONE', 'Piano di emergenza e prova di evacuazione', 'SICUREZZA_LUOGHI', null, 12, 'VERIFICA_NORMATIVA', null, 'D.M. 2/9/2021 (gestione della sicurezza antincendio in esercizio e in emergenza); D.Lgs. 81/2008', false, [],
    'Aggiornamento del piano di emergenza e prova di evacuazione almeno annuale con verbale.', null],
  ['SERVOSCALA', 'Servoscala e pedane per disabili', 'SICUREZZA_LUOGHI', null, 24, 'VERIFICA_NORMATIVA', 6, 'D.P.R. 162/1999 (se applicabile); D.M. 236/1989 (barriere architettoniche); indicazioni del fabbricante', true, [],
    'Manutenzione semestrale, verifica periodica dove prevista.', 'Verificare se il dispositivo rientra nel D.P.R. 162/1999 o nella sola direttiva macchine.'],
  ['VIDEOSORVEGLIANZA', 'Videosorveglianza e antintrusione', 'SICUREZZA_LUOGHI', null, null, 'CONTROLLO', 12, 'CEI 79-3; Provvedimento del Garante privacy in materia di videosorveglianza', false, [],
    'Manutenzione annuale, verifica di registrazione, conservazione delle immagini e cartelli informativi.', null],
  // ---- Impianti
  ['IMPIANTO_ELETTRICO_TERRA', 'Impianto elettrico e di messa a terra', 'IMPIANTI', null, 24, 'VERIFICA_NORMATIVA', null, 'D.P.R. 462/2001 (verifica periodica: biennale per i locali medici); CEI 64-8 sezione 710', true, [],
    'Verifica periodica dell\'impianto di terra da organismo abilitato, con verbale; nei locali ad uso medico la periodicità è biennale.', 'Nei locali non medici la periodicità ordinaria è quinquennale.'],
  ['QUADRI_ELETTRICI', 'Quadri elettrici', 'IMPIANTI', null, 12, 'CONTROLLO', 12, 'CEI 64-8; CEI EN 61439', false, [],
    'Controllo annuale (serraggi, termografia, differenziali) e manutenzione.', null],
  ['UPS', 'Gruppo di continuità (UPS)', 'IMPIANTI', null, 6, 'CONTROLLO', 12, 'CEI EN 62040; indicazioni del fabbricante', false, [],
    'Controllo semestrale dell\'autonomia, manutenzione annuale e sostituzione delle batterie a fine vita.', null],
  ['GRUPPO_ELETTROGENO', 'Gruppo elettrogeno (se presente)', 'IMPIANTI', 1, null, 'CONTROLLO', 12, 'CEI 64-8 sezione 710 (alimentazione di sicurezza); indicazioni del fabbricante', true, [],
    'Prova mensile a vuoto, manutenzione annuale, verifica del combustibile.', 'Solo dove presente.'],
  ['ASCENSORE', 'Ascensore e montacarichi', 'IMPIANTI', null, 24, 'VERIFICA_NORMATIVA', 6, 'D.P.R. 162/1999', true, [],
    'Verifica biennale da organismo notificato o ente abilitato, manutenzione periodica da ditta abilitata (almeno semestrale).', null],
  ['PORTE_AUTOMATICHE', 'Porte automatiche', 'IMPIANTI', null, null, 'CONTROLLO', 6, 'UNI EN 16005; indicazioni del fabbricante', false, [],
    'Manutenzione semestrale con verifica dei dispositivi di sicurezza.', null],
  // ---- Clima ed energia
  ['CLIMA_PDC', 'Climatizzazione e pompe di calore', 'CLIMA_ENERGIA', null, 12, 'CONTROLLO', 12, 'Regolamento (UE) 2024/573 (gas fluorurati); D.P.R. 74/2013 (libretto e controlli di efficienza)', true, [],
    'Manutenzione annuale, controllo delle perdite di gas fluorurati con periodicità che dipende dalla carica in CO2 equivalente, controllo di efficienza energetica.', 'La periodicità del controllo perdite va tarata sulla carica del singolo impianto.'],
  ['CALDAIA', 'Caldaia / generatore di calore', 'CLIMA_ENERGIA', null, 24, 'VERIFICA_NORMATIVA', 12, 'D.P.R. 74/2013; libretto di impianto', true, [],
    'Manutenzione annuale e controllo di efficienza energetica con rapporto, periodicità secondo potenza e combustibile.', 'La periodicità del controllo di efficienza dipende da potenza e combustibile.'],
  ['UTA_VENTILAZIONE', 'Impianto di aspirazione e ventilazione (UTA)', 'CLIMA_ENERGIA', null, 6, 'CONTROLLO', 12, 'UNI EN 16798; linee guida nazionali sulla manutenzione degli impianti aeraulici', false, [],
    'Controllo semestrale dei filtri, manutenzione e sanificazione annuale delle condotte.', null],
  ['FOTOVOLTAICO', 'Impianto fotovoltaico', 'CLIMA_ENERGIA', null, 12, 'CONTROLLO', 12, 'CEI 0-21; CEI 82-25', false, [],
    'Controllo annuale della produzione e degli inverter, pulizia dei moduli.', 'Solo dove presente; la produzione entra nell\'analisi energetica.'],
  ['CONTATORI_ENERGIA', 'Contatori e sottocontatori di energia', 'CLIMA_ENERGIA', 1, 12, 'CONTROLLO', null, 'UNI CEI EN ISO 50001 (monitoraggio e misura, se intrapresa)', false, [],
    'Lettura mensile interna, verifica annuale di taratura e coerenza con le bollette.', null],
  // ---- Igiene e ambiente
  ['LEGIONELLA', 'Impianto idrico: controllo della legionella', 'IGIENE_AMBIENTE', null, 6, 'CONTROLLO', 12, 'Linee guida per la prevenzione e il controllo della legionellosi (Conferenza Stato-Regioni)', false, [],
    'Valutazione del rischio, campionamenti periodici, manutenzione e disinfezione dei terminali.', 'Periodicità del campionamento secondo la valutazione del rischio.'],
  ['RIFIUTI_SANITARI', 'Area rifiuti sanitari e compattatore', 'IGIENE_AMBIENTE', 1, 12, 'CONTROLLO', null, 'D.P.R. 254/2003; D.Lgs. 152/2006 (registri di carico e scarico)', false, CLIN,
    'Sorveglianza mensile del deposito temporaneo, verifica annuale di registri e contratti di smaltimento.', null],
  ['DISINFESTAZIONE', 'Derattizzazione e disinfestazione', 'IGIENE_AMBIENTE', null, 3, 'CONTROLLO', null, 'Procedure SGI; contratto con ditta specializzata', false, [],
    'Interventi trimestrali con rapportino.', null],
  // ---- Emergenza
  ['DAE', 'Defibrillatore DAE', 'EMERGENZA', 1, null, 'CONTROLLO', 12, 'Legge 116/2021; indicazioni del fabbricante (scadenza di piastre e batteria)', false, [],
    'Verifica mensile dello stato e delle spie, manutenzione annuale, sostituzione di piastre e batteria alle scadenze.', null],
  ['CASSETTA_PS', 'Cassetta di pronto soccorso', 'EMERGENZA', 1, null, 'CONTROLLO', null, 'D.M. 388/2003', false, [],
    'Controllo mensile del contenuto e delle scadenze.', null],
  ['LAVAOCCHI', 'Lavaocchi e doccia di emergenza', 'EMERGENZA', 1, 12, 'CONTROLLO', null, 'UNI EN 15154', false, LAB,
    'Prova mensile di funzionamento, verifica annuale.', null],
  // ---- Laboratorio
  ['FRIGO_CAMPIONI', 'Frigoriferi e congelatori per campioni e farmaci', 'LABORATORIO', 1, null, 'CONTROLLO', 12, 'Procedure SGI (catena del freddo); indicazioni del fabbricante', false, CLIN,
    'Monitoraggio delle temperature con revisione mensile, manutenzione annuale e verifica delle sonde.', null],
  ['CENTRIFUGA', 'Centrifuga', 'LABORATORIO', null, null, 'CONTROLLO', 12, 'CEI EN 61010; indicazioni del fabbricante', false, CLIN,
    'Manutenzione annuale con verifica di velocità e sicurezze.', null],
  ['AUTOCLAVE', 'Autoclave e sterilizzatrice', 'LABORATORIO', null, 12, 'CONTROLLO', 12, 'UNI EN ISO 17665; UNI EN 13060', true, [...AMB, 'LABORATORIO'],
    'Manutenzione annuale e convalida periodica del processo di sterilizzazione.', null],
  ['CAPPA_BIOLOGICA', 'Cappa di sicurezza biologica', 'LABORATORIO', null, 12, 'CONTROLLO', 12, 'UNI EN 12469', true, LAB,
    'Verifica annuale di flussi e filtri HEPA con certificato.', null],
  ['CAPPA_CHIMICA', 'Cappa chimica', 'LABORATORIO', null, 12, 'CONTROLLO', 12, 'UNI EN 14175', false, LAB,
    'Verifica annuale della velocità frontale e del contenimento.', null],
  ['ANALIZZATORE_LAB', 'Strumentazione analitica di laboratorio', 'LABORATORIO', null, null, 'CONTROLLO', 12, 'Contratto di assistenza del fornitore; UNI EN ISO 15189 (se applicata)', false, LAB,
    'Manutenzione preventiva secondo il contratto del fornitore, registrazione dei controlli.', 'Periodicità da contratto di assistenza.'],
  // ---- Elettromedicali
  ['ELETTROMEDICALE', 'Apparecchiatura elettromedicale (generica)', 'ELETTROMEDICALE', null, 24, 'CONTROLLO', 12, 'CEI EN 62353 (verifiche di sicurezza elettrica); indicazioni del fabbricante', false, CLIN,
    'Verifica di sicurezza elettrica con periodicità del fabbricante (di norma annuale o biennale), manutenzione preventiva.', 'Periodicità dal manuale del fabbricante.'],
  ['ECOGRAFO', 'Ecografo', 'ELETTROMEDICALE', null, 12, 'CONTROLLO', 12, 'CEI EN 62353; controlli di qualità del fabbricante', false, AMB,
    'Verifica di sicurezza elettrica e controlli di qualità delle sonde, manutenzione annuale.', null],
  ['ELETTROCARDIOGRAFO', 'Elettrocardiografo', 'ELETTROMEDICALE', null, 24, 'CONTROLLO', 12, 'CEI EN 62353', false, AMB,
    'Verifica di sicurezza elettrica, manutenzione annuale.', null],
  ['ELETTROMIOGRAFO', 'Elettromiografo', 'ELETTROMEDICALE', null, 12, 'CONTROLLO', 12, 'CEI EN 62353', false, AMB,
    'Verifica di sicurezza elettrica, manutenzione annuale.', null],
  ['ARREDI_SANITARI', 'Arredi sanitari (lettini, poltrone prelievo)', 'ARREDI', null, 12, 'CONTROLLO', null, 'Indicazioni del fabbricante (dispositivi medici)', false, CLIN,
    'Controllo annuale di integrità, regolazioni e parti elettriche.', null],
  // ---- Diagnostica per immagini
  ['RADIOLOGIA_RX', 'Apparecchiatura radiologica (RX)', 'DIAGNOSTICA_IMMAGINI', null, 12, 'VERIFICA_NORMATIVA', 6, 'D.Lgs. 101/2020 (controlli di qualità e sorveglianza fisica con l\'esperto di radioprotezione)', true, IMG,
    'Controlli di qualità e sorveglianza fisica dell\'esperto di radioprotezione, manutenzione semestrale del fornitore.', null],
  ['MAMMOGRAFO', 'Mammografo', 'DIAGNOSTICA_IMMAGINI', null, 12, 'VERIFICA_NORMATIVA', 6, 'D.Lgs. 101/2020', true, IMG,
    'Controlli di qualità e sorveglianza fisica, manutenzione semestrale.', null],
  ['DENSITOMETRO_MOC', 'Densitometro osseo (MOC)', 'DIAGNOSTICA_IMMAGINI', null, 12, 'VERIFICA_NORMATIVA', 12, 'D.Lgs. 101/2020', true, IMG,
    'Controlli di qualità con fantoccio e sorveglianza fisica, manutenzione annuale.', null],
  ['TC', 'Tomografo computerizzato (TC)', 'DIAGNOSTICA_IMMAGINI', null, 12, 'VERIFICA_NORMATIVA', 6, 'D.Lgs. 101/2020', true, IMG,
    'Controlli di qualità e sorveglianza fisica, manutenzione del fornitore da contratto.', null],
  ['RM', 'Tomografo a risonanza magnetica (RM)', 'DIAGNOSTICA_IMMAGINI', null, 12, 'VERIFICA_NORMATIVA', 6, 'D.M. 14/1/2021 (standard di sicurezza delle apparecchiature RM)', true, IMG,
    'Controlli di qualità e di sicurezza con l\'esperto responsabile, manutenzione del fornitore da contratto.', null],
  // ---- IT
  ['RETE_SERVER_IT', 'Reti, server e apparati IT', 'IT', null, 6, 'CONTROLLO', 12, 'Regolamento (UE) 2016/679 (sicurezza del trattamento); procedure IT interne', false, [],
    'Controllo semestrale di backup e aggiornamenti, manutenzione annuale degli apparati.', null],
];

export const ASSET_TYPES_SEED = RAW.map(([code, name, category, surveillance_months, check_interval_months, check_kind, maintenance_interval_months, legal_reference, requires_certified_vendor, applies_to_kinds, description, nota], i) => ({
  code, name, category, surveillance_months, check_interval_months, check_kind, maintenance_interval_months, legal_reference, requires_certified_vendor,
  applies_to_kinds, description, benchmark_note: nota ? `${NOTA} ${nota}` : NOTA, active: true, sort: (i + 1) * 10,
}));

export const ASSET_CATEGORIES = {
  SICUREZZA_ANTINCENDIO: 'Sicurezza antincendio', SICUREZZA_LUOGHI: 'Sicurezza dei luoghi', IMPIANTI: 'Impianti', CLIMA_ENERGIA: 'Clima ed energia',
  ELETTROMEDICALE: 'Elettromedicali', DIAGNOSTICA_IMMAGINI: 'Diagnostica per immagini', LABORATORIO: 'Laboratorio', IT: 'IT', ARREDI: 'Arredi',
  EMERGENZA: 'Emergenza', IGIENE_AMBIENTE: 'Igiene e ambiente',
};
export const SITE_KINDS_FACILITY = ['PUNTO_PRELIEVI', 'CENTRO_DIAGNOSTICO', 'POLIAMBULATORIO', 'CENTRO_MEDICO', 'LABORATORIO', 'HEADQUARTER'];

// Controllo del seed (anche nei test): codici unici, categorie e tipologie ammesse, almeno una periodicità per voce
export function validateAssetTypes(list = ASSET_TYPES_SEED) {
  const errs = [];
  const codes = new Set();
  for (const t of list) {
    if (!/^[A-Z0-9_]{2,40}$/.test(t.code || '')) errs.push(`codice non valido: ${t.code}`);
    if (codes.has(t.code)) errs.push(`codice duplicato: ${t.code}`);
    codes.add(t.code);
    if (!ASSET_CATEGORIES[t.category]) errs.push(`${t.code}: categoria ${t.category} non ammessa`);
    if (!['CONTROLLO', 'VERIFICA_NORMATIVA'].includes(t.check_kind)) errs.push(`${t.code}: check_kind non ammesso`);
    if (!t.surveillance_months && !t.check_interval_months && !t.maintenance_interval_months) errs.push(`${t.code}: nessuna periodicità`);
    for (const k of t.applies_to_kinds || []) if (!SITE_KINDS_FACILITY.includes(k)) errs.push(`${t.code}: tipologia di sede ${k} non ammessa`);
    if (!String(t.benchmark_note || '').includes('da confermare con RSPP e Qualità')) errs.push(`${t.code}: manca la nota "da confermare"`);
  }
  return errs;
}
