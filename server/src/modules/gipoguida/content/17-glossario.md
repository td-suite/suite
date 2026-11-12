---
capitolo: 17
titolo: Glossario
intro: I termini e le sigle che si incontrano in GIPO, spiegati in breve.
---

=== sezione
ordine: 1
slug: glossario-termini
titolo: Termini di GIPO
parole_chiave: glossario, significato, termini, assegnazione, listino, sezionale, impegnativa, centro di lavoro, risorsa, episodio, pacchetto, ciclo terapeutico, anagrafica erogante, slot, wizard
sintesi: Significato dei termini usati in GIPO (assegnazione, listino, sezionale, slot, sottoconfigurazione...).
fonte: INTERFACCIA
livello: OPERATIVO
===
- **Agenda**: il calendario di un medico, di un ambulatorio o di una macchina, con orari e slot prenotabili.
- **Anagrafica erogante**: il soggetto che emette la fattura (configurato in Fatturazione > Anagrafiche).
- **Assegnazione**: la "pratica" del paziente con prestazioni, listino, prezzi, impegnativa SSN, appuntamenti e fatture. Vedi [Che cos'è un'assegnazione](sezione:assegnazione-cos-e).
- **Centro di lavoro**: un raggruppamento usato nei filtri di assegnazioni, fatture di gruppo e Riepilogo Asl (configurato in Agende > Centri di lavoro).
- **Ciclo terapeutico**: una serie di sedute della stessa prestazione raggruppate nell'assegnazione.
- **Episodio**: il nome che si dà a un'assegnazione (per esempio una terapia), visibile anche in Gruppo assegnazioni.
- **Fatturare a**: il soggetto a cui va la fattura dell'assegnazione, se diverso dal paziente.
- **Impegnativa**: la prescrizione del medico (ricetta) per le prestazioni a carico del SSN; può essere interna, rossa o dematerializzata.
- **Listino**: l'elenco dei prezzi delle prestazioni; ce ne possono essere diversi (privato, convenzioni, assicurazioni, SSN).
- **Lista di lavoro**: la pagina iniziale con gli appuntamenti del periodo e il menu Azioni.
- **Pacchetto**: un insieme di prestazioni venduto insieme (si configura con la Distinta base della prestazione).
- **Prestazione**: un esame o una visita che si può prenotare e fatturare.
- **Regime di erogazione**: la modalità di erogazione di una prestazione SSN, aggiornabile dal Riepilogo Asl.
- **Risorsa**: ciò su cui si prenota (Altro, Ambulatorio, Box, Macchina, Medico, Risorsa Generica, Stanza, Terapista).
- **Sezionale**: la serie di numerazione di fatture, note di credito e DDT.
- **Slot**: l'intervallo prenotabile dell'agenda (da 5 a 60 minuti nel modulo osservato il 13/11/2026).
- **Sottoconfigurazione**: un orario alternativo di un'agenda valido in un periodo, anche a settimane alterne (Periodicità in settimane) o solo in certi giorni del mese (Periodicità nel mese). Vedi [Sottoconfigurazioni](sezione:agenda-sottoconfigurazioni).
- **Configurazione base**: l'orario settimanale normale di un'agenda.
- **Distinta base**: l'elenco delle prestazioni che compongono un pacchetto.
- **Occupazione parziale**: la quota di slot (Peso %) occupata da una prestazione.
- **Wizard**: la prenotazione guidata a carrello.

=== sezione
ordine: 2
slug: glossario-sigle
titolo: Sigle e abbreviazioni
parole_chiave: sigle, abbreviazioni, e/c, p/ssn, ssn, fse, sdi, ts, ddt, cup, coge, lis, md, pec, p.a., fatt-e, sar, sac, cdl, iva, inps
sintesi: Significato delle sigle che compaiono in GIPO (CUP, FSE, SDI, TS, LIS, CoGe...).
fonte: INTERFACCIA
livello: OPERATIVO
===
- **Asl**: Azienda sanitaria locale.
- **Cdl**: centro di lavoro (per esempio "Proponi Cdl precedente" nella configurazione SSN).
- **CoGe**: contabilità generale (Codice CoGe di prestazioni, gruppi, specialità).
- **CUP**: Centro unico di prenotazione (Codice CUP, Agenda Cup, origine impegnativa CUP).
- **DDT**: documento di trasporto.
- **E/C**: colonna di Gestione Fatture/NC e Gestione cassa. Il significato della sigla non è spiegato dall'interfaccia: da verificare con l'amministrazione.
- **Fatt-e**: fattura elettronica (Codice destinatario Fatt-e).
- **FEPA**: fattura elettronica verso la Pubblica Amministrazione (Codice FEPA nelle prestazioni).
- **FSE**: Fascicolo Sanitario Elettronico.
- **LIS**: sistema informativo del laboratorio (Codice LIS delle prestazioni).
- **MD**: MioDottore (Consenti condivisione su MD, Condiviso MD).
- **P.A.**: Pubblica Amministrazione (campo della scheda paziente).
- **P/SSN**: colonna di Gestione cassa; dal nome distingue i documenti privati da quelli SSN (da verificare).
- **PEC**: posta elettronica certificata.
- **SAR / SAC**: origine delle impegnative nel Riepilogo Asl (sistema di accoglienza regionale e sistema di accoglienza centrale delle ricette dematerializzate); il loro uso nella configurazione TD va verificato.
- **SDI**: Sistema di interscambio dell'Agenzia delle entrate per le fatture elettroniche (Tipologia Sdi dei metodi di pagamento).
- **SSN**: Servizio sanitario nazionale.
- **TS**: Sistema Tessera Sanitaria (Opposizione invio sistema TS, Gipo730).

=== sezione
ordine: 3
slug: glossario-manuale
titolo: Termini del manuale operativo TD
parole_chiave: glossario manuale, ae title, cup, dicom, fse 2.0, giposign, gipo smartq, gipo ssn, gipo ts, hl7, lis, mpps, nre, pacs, ris, sts, tsrm, wado, worklist dicom, agenda classica, agenda wizard, associa medico
sintesi: Le definizioni del glossario del manuale operativo TD-SGI-MAN007: AE Title, Agenda Classica e Wizard, Associa Medico, CUP, DICOM, FSE 2.0, GipoSign, SmartQ, GIPO SSN e TS, HL7, LIS, MPPS, NRE, PACS, RIS, STS, TSRM, WADO, worklist.
fonte: MANUALE_TD
livello: OPERATIVO
stato: VALIDATA
validazione: Manuale operativo TD-SGI-MAN007
===
- **AE Title** (Application Entity Title): identificativo univoco di una modalità DICOM in rete.
- **Agenda Classica**: modalità di prenotazione per appuntamenti singoli con una sola risorsa.
- **Agenda Wizard**: modalità di prenotazione per prestazioni complesse che richiedono insieme specialista, sala e apparecchiatura.
- **Associa Medico**: funzione che associa il medico refertante all'episodio clinico in fase di assegnazione.
- **CUP** (Centro Unico di Prenotazione): sistema di prenotazione regionale o nazionale integrato con GIPO.
- **DICOM** (Digital Imaging and Communications in Medicine): standard per le immagini diagnostiche.
- **FSE 2.0** (Fascicolo Sanitario Elettronico 2.0): archivio digitale della storia clinica del paziente.
- **GipoSign**: modulo per la firma grafometrica con app su tablet Android.
- **GIPO SmartQ**: modulo per il monitor della sala d'attesa (coda, numero, ambulatorio).
- **GIPO SSN**: modulo per la rendicontazione SSN e la trasmissione al Sistema Tessera Sanitaria.
- **GIPO TS**: modulo per la lettura della tessera sanitaria a banda magnetica.
- **HL7** (Health Level Seven): standard per lo scambio di informazioni sanitarie tra sistemi.
- **LIS** (Laboratory Information System): gestione del flusso di lavoro del laboratorio.
- **MPPS** (Modality Performed Procedure Step): messaggio DICOM che aggiorna lo stato dell'esame.
- **NRE** (Numero Ricetta Elettronica): codice univoco della ricetta dematerializzata SSN.
- **PACS** (Picture Archiving and Communication System): archivio delle immagini diagnostiche digitali.
- **RIS** (Radiology Information System): gestione del flusso di lavoro radiologico.
- **SSN**: Servizio Sanitario Nazionale.
- **STS** (Sistema Tessera Sanitaria): infrastruttura MEF/Sogei per il 730 precompilato.
- **TSRM**: Tecnico Sanitario di Radiologia Medica.
- **WADO** (Web Access to DICOM Objects): visualizzazione DICOM nel browser.
- **Worklist DICOM**: lista di lavoro inviata da GIPO e ZeeroMed alle apparecchiature con i dati del paziente e della prestazione.
