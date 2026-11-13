# memory.md · Suite TD

## Stato corrente
Anagrafica unica (25/10/2026, decisione di Francesco: "Suite tutta vuota, perfezione logica, niente riconciliazioni"): sedi, organizzazioni, persone, utenti solo in public; otto moduli convertiti con tabelle di estensione (cash site_ext/org_ext, room site_ext/person_ext, nc site_ext, orders site_ext, retail site_ext/person_ext, contracts person_ext/person_areas, business org_ext, integration org_ext/person_ext) e avvio vuoto; Finance Management e Spedizioni restano a travaso. Caricamento XLSX in Amministrazione > Importazioni con modelli (Sedi, Organizzazioni, Persone, Utenti+profili) e azzeramento della Suite (titolare). Rimossi: sincronizzazione anagrafiche dalle app, Riconciliazione, "Unisci in". Foto sedi (3), barra di ricerca → icona, menu dei moduli razionalizzati (Cruscotto ovunque, Riconciliazione bancaria, Comunicazioni ai professionisti, Nuova persona/Elenco persone, tolta "Le mie notifiche" di NC), Cognome Nome anche nei moduli. Collaudo locale: reset → 4 XLSX → 8 moduli avviati → tutte le pagine aprono. Agg. 25/10/2026.

Fase 1 completata in locale il 24/10/2026 (notte): le 10 app operative sono moduli della Suite (room, integration, finance, business, shipments, nc, orders, cash, retail, contracts), ognuna con schema PostgreSQL proprio, migrazioni originali, dati copiati dal job di travaso (OFF / MIRROR / LIVE, Amministrazione > Travaso moduli), interfaccia dentro la Suite con CSS isolato e sidebar generata da meta.js. Canali macchina (StudioLAB HL7/LIS, fornitori Ordini) montati prima della sessione con mountPublic. Home, Cockpit, ricerca e /go aprono il modulo dentro la Suite appena è in MIRROR o LIVE. Variabili delle integrazioni in server/.env.moduli.example. Repository v0.2 in WebApp Suite\Suite TD. Agg. 24/10/2026.

Fase 0 costruita e collaudata in locale il 24/10/2026: server (auth Entra + locale + TOTP, utenti e grant con regola Owner su Contracts, anagrafiche, SSO verso le app legacy, Community completa, file su Azure Blob, ricerca full-text con risposta di Claude, sync in sola lettura dai 10 DB legacy con riconciliazione di utenti, sedi, organizzazioni, persone, cockpit, contatori, API di ingestione a chiave), interfaccia React PWA con 16 icone originali, tema chiaro e scuro, modulo PowerShell TD.Suite v0.1, patch SSO per le app con patch pronta per Room. Repository in WebApp Suite\Suite TD\2026-10-24_SuiteTD_v0.1_repo.zip; schermate in screens\. Modello Claude: claude-sonnet-5-5 (claude-sonnet-4-5 non disponibile sulla chiave; il parametro temperature è deprecato e rimosso). Agg. 24/10/2026.

Da fare per il go-live (Francesco): repository GitHub "suite" e push; Render Blueprint; app registration Entra "Suite TD" con redirect e Mail.Send; storage account Azure con container "suite"; variabili su Render (Entra, Blob, Anthropic, LEGACY_*_DATABASE_URL); DNS CNAME suite; patch SSO su Room con SUITE_SSO_SECRET; conferma delle proposte di grant in Amministrazione. Checklist completa nel README del repo. Agg. 24/10/2026.

Da fare (Claude), fase 0 residua: test automatici in server/test, verifica reale di Blob, Graph e Open-Meteo in produzione, passkey (WebAuthn), notifiche push, densità dei widget in home (icone più grandi), accessibilità verificata. Fase 2: portali SGI e Service come modulo documentale, migrazione dei BYTEA su Blob, restyling per modulo, test in server/test. Agg. 24/10/2026.

Ipotesi dichiarate: durata complessiva 4-6 mesi per avere tutti i moduli dentro; costi infrastruttura 250-400 euro al mese da verificare sui listini Render.

## Diario
24/10/2026. Avvio progetto. Analizzati i 12 repository (10 app Node gemelle + 2 portali Flask). Consegnata proposta di architettura v0.1 (DOCX, 14 capitoli, 10 decisioni). Francesco ha risposto a tutte le decisioni, confermato le nove aggiunte, fissato il go-live a 48 ore e indicato Contracts come sorgente degli utenti. Fonte: chat.
24/10/2026. Costruita la fase 0 (server, web, PowerShell, patch SSO) con tre blocchi in parallelo; integrazione, correzioni (GROUP BY nel dettaglio utente, confronto id nelle audience, indicizzazione su scrittura, modello Claude, favicon Room) e test con Claude riusciti (frasi del giorno generate). Repository zip e schermate in WebApp Suite\Suite TD. Fonte: chat e collaudo locale.
24/10/2026 (sera). Home ridisegnata come dashboard centrata (fascia scura con saluto, meteo, ricerca e indicatori vivi; widget centrati per area; Community su tre colonne). Aree e ordine dei widget decisi da Francesco: Direzione (Cockpit, Amministrazione), Finance (Finance Management, Cash Management, Integration M&A), Retail and Flow Management (Contratti B2C/B2B, Room Planning, Retail Assistant, Comunicazione), Operations (Ordini e Magazzino, Spedizioni e Kit), HQS (SGI Management, Portale Service, Non conformità), People (Contratti del Personale, Rubrica e Organigramma). Sede Direzione (Viale Belfiore 55, Firenze) nel seed. Favicon di Room. Fonte: chat.
24/10/2026 (notte). Travaso delle 10 app in due ondate di agenti paralleli (room, integration, finance, business, shipments; poi nc, orders, cash, retail, contracts), collaudo locale con database di prova per ciascuna. Infrastruttura: lib/travaso.js (schema, migrazioni, FK differibili, copia per tipo di colonna, lotti piccoli per bytea, sequenze), lib/modules.js (pool per schema, utente del modulo, stato), registry web con import.meta.glob e plugin Vite per il CSS. Integrazione finale: hook mountPublic per i canali macchina, collegamenti interni per i moduli attivi, scorrimento della sidebar, README e .env.moduli.example. Fonte: collaudo locale.
25/10/2026 (mattina). v0.3: home compatta (sezioni per area su griglia a 5 colonne, aree piccole affiancate, tessere pulite senza aloni, fascia alta ridotta), Community in griglia ordinata, frase del giorno come card normale, meteo della sede più vicina alla posizione del browser (fallback sede del profilo), Cognome Nome ovunque (colonne first_name/last_name sugli utenti, migrazione 004, form Utenti con Cognome e Nome), interruttori dei widget riparati (la pista copriva la casella: il clic non arrivava), interni del centralino sulle schede persona e card Numeri interni in Rubrica (seed/centralino.js, migrazione 005), card Rubrica senza testi fuori riquadro, ruolo = descrizione lunga non più usato come titolo. Fonte: richieste di Francesco in chat, collaudo locale.
25/10/2026 (mattina, seguito). Francesco: niente riconciliazioni, niente unioni, Suite vuota e caricamento una volta sola da XLSX; i 20 giorni di dati delle app si perdono (accettato). Conversione di otto moduli all'anagrafica unica con agenti paralleli (ricetta docs/ANAGRAFICA.md), importazione XLSX con modelli e azzeramento, pulizia di menu e anagrafiche duplicate (cash companies, business partners, integration targets/team, retail site_staff, contracts resources/work_sites, room professionisti/strutture, nc sedi, orders strutture). Finance Management LIVE in produzione (collaudato da Francesco). Fonte: chat e collaudo locale.

## 26/10/2026 · collaudo dell'avvio dei moduli (locale)
Otto moduli avviati vuoti e LIVE con "Avvia" (cash, room, nc, orders, retail, contracts, business, integration) sull'anagrafica unica;
103 pagine interne dei moduli aperte senza errori (correzione: GROUP BY in Ordini > Rete). "Passa a LIVE" su un modulo già LIVE non dà
più errore. Finance Management è già LIVE in produzione; Spedizioni resta a travaso classico (sorgente legacy, sync, travaso, confronto, LIVE).

## 29/10/2026 · Audit SGI
Nuovo widget nativo `audit` in HQS (richiesta del CEO): auto-audit mensili delle sedi compilati dal site manager con colonna parallela
del verificatore e alert del 17, audit interni, audit di terze parti (PDF con testo estratto), audit ISO 37001 sui partner (Legal entity),
sintesi con Claude per sede (esito in `public.site_sgi_scores` → riquadro "Allineamento SGI" nella scheda sede di Retail Assistant), per la
rete e per i partner, archivio con cestino ed export XLSX/PDF, PDF del singolo audit nello stile del modulo. Collaudo locale con db
dedicato, test `audit-scoring.test.mjs`, screenshot `docs/screens/audit-*.png`. Da verificare con la chiave Anthropic reale. Dettagli in
docs/AUDIT_SGI.md.

## Ordini: catalogo articoli dall'app originale (29/10/2026)
Amministrazione > Travaso moduli > Ordini e Magazzino > "Importa i contenuti dall'app originale": copia categorie, articoli e abbinamenti esame → articolo da orders.toscanadiagnostica.it (sorgente LEGACY_ORDERS_DATABASE_URL o Sorgenti legacy), ripetibile senza duplicati (legacy_import_map). Confezioni per struttura e giacenze non si importano: dipendono dalle strutture dell'app, che nella Suite sono sedi e Legal entity dell'anagrafica unica.

## 31/10/2026 · Ordini: Magazzino Centrale e Dotazione di avvio sedi
Richiesta del CEO: "Magazzino Silva" rinominato Magazzino Centrale; visibilità degli articoli a quattro tipologie (Punti Prelievo,
Centro Polidiagnostico, Laboratorio di Analisi, Service, più Tutti; colonne nuove visible_poli e visible_lab dal tipo di sede); nuova
sezione "0b · Dotazione di avvio sedi" con modelli per tipologia (quattro, Legal entity comprese), sedi e Legal entity con data di
effettiva apertura (public.sites.opened_at; start_date per le Legal entity), piano per struttura, ordine facoltativo, Giacenza 0
(packages INIZIALE) con annullamento solo SUPERADMIN, PDF e badge (aperture entro 60 giorni senza Giacenza 0). Migrazione
orders/009_dotazione_avvio.sql, test orders-startup.test.mjs, schermate docs/screens/orders-dotazione-*.png. Dettagli in
docs/ANAGRAFICA.md (sezione Ordini).

## 31/10/2026 · Facility e Manutenzioni
Nuovo widget nativo `facility` in OPERATIONS (richiesta del CEO): Catalogo dispositivi in Amministrazione (public.asset_types, migrazione
033, 46 voci di benchmark da confermare con RSPP e Qualità), immobili delle sedi con canone e scadenze dal contratto di Finance Management, obblighi di
controllo, documenti e planimetria pubblicata in Room Planning (room.struttura_blobs), utenze e bollette scritte nello Scadenziario
strutture di Finance Management, energy management (consumi, costi, CO2, kWh/m2, per accettazione e per ora, anno su anno, anomalie, classifica tra
sedi, obiettivi, fasce indicative, analisi con Claude, rapporti PDF/XLSX), dispositivi con QR e piano delle scadenze rigenerato alla
chiusura, interventi con SLA e segnalazione guasti del site manager, KPI, job `facility:scadenze` con promemoria 30/7/0 giorni.
Collaudo locale su db proprio (116 controlli API), test `facility.test.mjs`, schermate `docs/screens/facility-*.png`. Da confermare i
benchmark e da provare l'analisi con la chiave Anthropic reale. Dettagli in docs/FACILITY.md.

## 01/11/2026 · SGI Management nativo (copia conforme di sgi.toscanadiagnostica.it)
Richiesta del CEO: "Vorrei fare poi la stessa cosa con SGI! Perfettamente!". Modulo `sgi` (widget HQS SGI Management, `/sgi`, aperto a
tutti, EDITOR per le Impostazioni) sul modello del Portale Service: specchio di sola lettura del sito (job `sgi:specchio` ogni 6 ore,
Aggiorna adesso, ZIP del repo, PDF in cache, link stabili `/sgi/doc|m|p`), credenziali HTTP Basic cifrate per l'origine protetta,
cruscotto con ricerca full-text, riquadri, famiglie e aree, Ultime emissioni, Documenti cardine, Versioni stampabili, Indice REG006,
Mappa concettuale e Politica nel visualizzatore, Preparazioni, Scrivi alla Qualità. Meccanica dello specchio estratta in
`lib/specchioPortale.js` e `lib/specchioRegole.js`, usata anche dal Portale Service (test invariati). Migrazione core 038. Collaudo locale
su db proprio con origini finte (anche protetta), test `sgi-*.test.mjs`, schermate `docs/screens/sgi-*.png`. Dettagli in docs/SGI_PORTALE.md.

## 05/11/2026 · Correzioni del debug pre-produzione (v0.45.0 + correzioni, non ancora versionate)
Chiusi i problemi del rapporto di debug (B1-B3, A1-A3, M1-M10, L1-L16; L18 non è un difetto del prodotto) con l'autorizzazione del CEO.
Punti di architettura: `lib/servFile.js` serve tutti i file caricati dagli utenti (tipo dall'estensione e dalla firma, in linea solo PDF e
immagini raster, nosniff e sandbox); `lib/errori.js` è il gestore unico degli errori (SQLSTATE 22 → 400, nessun codice SQLSTATE nelle
risposte, NUL tolti dai corpi JSON); `users.is_external` (migrazione 040) rende stabile lo stato di accesso esterno; `requireAuth` verifica
anche la presa d'atto delle informative; il profilo Default dà Cartella in consultazione e Ticket in solo inserimento (profilo UTENTE);
account automatico solo per i domini di `app_settings 'accounts.domini_automatici'`. Test d'integrazione in `server/test/perimetri.test.mjs`
e `sessione.test.mjs` con `test/helpers/suiteTest.mjs` (servono `DATABASE_URL_TEST`, altrimenti saltati con messaggio).
Restano aperti: zod 4 (cambia la semantica di `.partial()` con `.default()`), react-router 7 (major), SheetJS dalla CDN ufficiale
(non raggiungibile dall'ambiente di sviluppo). Rapporto completo: `RAPPORTO_VERIFICA.md` del collaudo.

## 06/11/2026 · Business Hub (v0.47.0)
Il widget "Contratti B2C/B2B" diventa **Business Hub** (richiesta del CEO; chiave `business` invariata): CRM a fasi per Legal entity e
linea con diario dei contatti, referenti, criticità, feed da NC, Ordini, Ticket, Circolari e Portale, caselle service@/network@/mdl@ in
lettura e invio con copie fisse, cliente attivo impostato solo dal CEO o da un Admin del modulo, import del DB Opportunità del CEO con
abbinamento a contratti e Legal entity esistenti, vista navigabile con export XLSX e PDF, proposte modificabili anche dopo la firma con
revisioni (caso AgapeLab). Migrazioni business 008 e core 041. Dettagli e numeri del collaudo in docs/BUSINESS_HUB.md.

## 09/11/2026 (sera) · v0.68.1
Richieste del CEO: Business Hub ↔ StudioLab (maturato Synclab, pro quota e run rate contro il FY atteso dichiarato in scheda, Pipeline e
Cruscotto, filtro "Solo in ritardo", D51); Conto economico con le stime commerciali in una riga non sommata, composizione dell'effettivo e
"Da dove viene" su ogni KPI; Cockpit a schermo unico (1920×1080 e 1366×768 senza scorrimento: Ricavi B2C + B2B, Laboratorio con TOP 5,
Retail B2C, Scadenze e persone); Room: esterni con ruolo, sede o disciplina tra i professionisti (migrazione room 013), aggancio del
personale di sede per person_id, D52. Test `server/test/v0681-correlazioni.test.mjs`. Dettagli: BUSINESS_HUB.md, FINANCE.md, COCKPIT.md,
SYNCLAB_DATA_API.md, IMPOSTAZIONI.md.

## 09/11/2026 (notte) · v0.68.2
Ordini → Silva secondo la Guida tecnica API ordini v1 definitiva (docs/silva-api-ordini/): destinazioni Silva per struttura (GET
destinazioni con cache, proposta per CAP/indirizzo da confermare, D53), corpo della POST con i soli campi della guida (codici e unità del
catalogo Silva, unità totali intere, blocco locale con messaggio per Ops), risposte 201/200/400 (immutable_order)/401-403/429/503,
limitatore condiviso con il catalogo (30 al minuto), stato presso Silva ogni 30 minuti (IN_PREPARAZIONE → presa in carico, EVASO →
spedito, ANNULLATO e 404 → segnalazione), primo invio concordato (`primo_invio_confermato`) prima dell'automatismo, colonna e riquadro
"Silva". Migrazione orders 015. Test `server/test/orders-silva-v1.test.mjs`. Dettagli: SILVA_API_ORDINI.md, CONNETTORI.md.

## 10/11/2026 · v0.68.3
Ordini, punto di consegna per le Legal entity cliente con più sedi service (richiesta del CEO: Kos S.p.A. con Ville di Nozzano e Villa
dei Pini). Ordini, giacenze, produzione e dotazione restano sulla Legal entity (A4); l'ordine ha `delivery_site_id` ("Consegnare a":
obbligatorio con 2 o più punti, preselezionato con uno, perimetro dell'utente), cambiabile da Ops fino alla ricevuta di Silva, mostrato
come "Kos S.p.A. · Villa dei Pini" ovunque (lista con filtro, dettaglio, PDF, email, trasmissione, export) e trasmesso con la
destinazione Silva del punto; ordini di prima senza punto: avviso e approvazione bloccata finché Ops non lo indica. Destinazioni Silva:
unità = sedi TD, Legal entity senza punti, punti service; abbinamento automatico delle coincidenze univoche (CAP + via e civico o CAP +
nome, codice libero) su "Aggiorna destinazioni" e con il job `orders:silva-destinazioni` ogni 6 ore; gruppi Abbinate / Da scegliere /
Non presenti in Silva e destinazioni presenti in Silva non in anagrafica; D53 sulle unità. Giacenza per punto non gestita (decisione
aperta). Migrazione orders 016, test `server/test/orders-punto-consegna.test.mjs`. Dettagli: SILVA_API_ORDINI.md sezioni 2 e 2 bis.

## 11/11/2026 · v0.69.0 · Label (etichette provette, stampa Zebra)
Richiesta del CEO del 10/11/2026 ("widget davvero fondamentale"): nuovo modulo nativo **Label** (chiave `etichette`, Retail and Flow dopo
il Business Hub, per sede, solo con grant: ADMIN e OPERATORE). Dal numero di accettazione o barcode (copia Synclab con la ricerca del Desk
NC; se manca, lettura diretta del gestionale con `requestNumber`/`sampleBarcode` e il 202) o dal cognome (solo identità recenti) mostra le
etichette per provetta (una per campione con gli esami di quella provetta) e le stampa sulla Zebra della sede con Zebra Browser Print
(https://127.0.0.1:9101, http://127.0.0.1:9100; stampante ricordata per PC; CSP aggiornata) o in PDF di ripiego. Identità dei pazienti solo
in `etichette.pazienti_recenti` per N giorni (predefinito 7, massimo 30; CF mai; job `etichette:identita` ogni 15 minuti tra le 6 e le 22,
30 chiamate per giro; purga quotidiana); la proiezione paziente globale resta spenta. Modello dell'etichetta configurabile (ZPL con
segnaposto, misure, dpi), predefinito "TD 50x25 (da validare)" con avviso fisso finché il laboratorio non lo valida; renderer ZPL proprio
(Code 128 B/C) per anteprima e PDF, identico in server e web. Registro stampe e audit senza dati del paziente. Diagnostica D54 e D55.
Migrazione del modulo `etichette/001_init.sql` (si avvia da Travaso moduli > Avvia). Test `server/test/etichette.test.mjs`; collaudo su db
proprio con server finto Synclab e finto Browser Print; schermate `docs/screens/etichette-*.png`. Da fare: disegno di StudioLab e
validazione in sede con una Zebra vera (cosa non verificato: docs/LAB_CONTROL.md). Dettagli in docs/LAB_CONTROL.md e SYNCLAB_DATA_API.md.

## 12/11/2026 · v0.70.0 · Guida GIPO (guida di GipoNext, FAQ, ricerca e domande con risposta)
Richiesta del CEO del 12/11/2026 ("widget davvero fondamentale"): nuovo modulo nativo **Guida GIPO** (chiave `gipoguida`, Retail and Flow
dopo Label, aperto a tutti gli interni come LETTORE, esterni esclusi; ADMIN = redazione). Guida completa di GipoNext scritta come seme
versionato (`modules/gipoguida/content/`: 16 capitoli, 95 sezioni, 73 FAQ) dall'analisi dell'interfaccia del 12/11/2026, tutte le sezioni
DA_VALIDARE con il bollino; caricamento all'avvio solo delle voci non toccate a mano (impronta del seme). Pagine Chiedi (domande con
risposta di Claude solo sui brani della guida, tipo `gipoguida` in ai_log; senza AI risultati della ricerca), Guida (indice, sezione, Apri
in GIPO solo per le pagine di consultazione, PDF e anteprima), FAQ, Redazione (coda delle domande senza risposta o "non utili" → FAQ
pubblicata con notifica a chi aveva chiesto, editor con anteprima e storico, validazione con nota, statistiche). Mascheramento lato server
di CF, email e numeri lunghi; 20 domande all'ora; ricerca full text italiano con sinonimi minimi; PDF pdfkit con indice e numeri di pagina
(74 pagine), cache invalidata a ogni modifica; `cercaGuida` nella ricerca globale per gli interni; contatore in Home e job
`gipoguida:riepilogo` (notifica agli ADMIN il lunedì); Diagnostica D56. Nuovo `SOLO_INTERNI` in routes/core.js (Piano Ferie e Guida GIPO
spariscono anche lato server dalla Home e dal catalogo degli esterni). Test `server/test/gipoguida.test.mjs`; collaudo su db proprio con un
modello finto; schermate `docs/screens/gipoguida-*.png`. Da fare: referente interno, validazione delle sezioni con chi usa GIPO, prova con
Claude vero in produzione. Dettagli in docs/GIPO_GUIDA.md.

## 12/11/2026 · v0.71.0 · Lab Control (il widget Label diventa il controllo del laboratorio)
Richieste del CEO del 12/11/2026: il widget **Label** si chiama **Lab Control** ("Accettazioni, avanzamento, etichette"; chiave `etichette` e
route `/etichette` invariate, vecchi indirizzi di Label reindirizzati) e Label diventa una sua sezione con il menu di prima. Nuove pagine
sulla copia Synclab: Cruscotto (oggi per fase, in lavorazione, referti non chiusi, ritardi, campioni in viaggio, non eseguiti, TAT oggi/7
giorni/per sede), Accettazioni (paginate lato server, filtri cliente, sede, data, fase, ritardo, NC, non fatturate, numero/barcode/cognome;
colonne per utente; Excel senza nomi), Scheda (linea del tempo delle fasi, esami, campioni con il legame esame ↔ campione, totali, Etichetta,
Fattura dalla copia senza PDF, NC, "Aggiorna dal gestionale"), Campioni, In ritardo, Tempi di refertazione, Esami non eseguiti, Clienti,
Impostazioni. Fasi da una sola funzione (`lib/fasi.js`). Collegamenti verificati lato server verso Business Hub, Retail, Listino, Ordini,
NC (API `lib/collegamenti.js`) e link inversi da Business Hub, Retail, Desk NC e ricerca globale. Nuovo profilo LABORATORIO. Cockpit: tre
tessere di Lab Control nell'operatività; Diagnostica D57. Migrazione `etichette/002_lab_control.sql` (letture puntuali, indici sulla copia).
Test `server/test/labcontrol.test.mjs`; collaudo su db proprio con 4.200 accettazioni sintetiche; schermate `docs/screens/labcontrol-*.png`.
Dettagli e cosa la Data API non dà (PDF, data di ingresso negli stati, data di chiusura, significato dei codici di non esecuzione): docs/LAB_CONTROL.md.

## 13/11/2026 · v0.71.1 · Guida GIPO, risposte all'altezza del back-end
Il CEO ha chiesto alla guida "come faccio ad impostare un'agenda per un medico che viene in una struttura solo il primo e il terzo martedì
di ogni mese" e ha ricevuto "la guida non copre". Corretti contenuti e recupero. Contenuti: osservazioni di secondo livello del 13/11/2026
(schede interne di agende, prestazioni, medici, assegnazione, fattura) integrate; nuovo capitolo 14 **Back-end: configurare GIPO** (20
procedure con esempi e verifiche, tra cui Sottoconfigurazioni con Periodicità in settimane, Priorità e Periodicità nel mese, esempio svolto
del primo e terzo martedì); nuovo capitolo 15 **Percorso del paziente secondo il manuale TD** dal Manuale operativo TD-SGI-MAN007 (20 sezioni,
VALIDATA con la fonte del manuale, note "Da riconciliare con il manuale" dove manuale e interfaccia divergono); FAQ per ruolo e glossario
diventano capitoli 16 e 17. Da 95 a 140 sezioni, da 73 a 123 FAQ (50 nuove: 42 di back-end e 8 sulle regole del manuale). Campi nuovi `fonte`, `livello`, `sintesi`,
validazione dal seme (migrazione `gipoguida/002_back_end.sql`, idempotente). Recupero: indice esteso con pesi A/B/C/D (titolo, parole
chiave, sintesi, capitolo, domande delle FAQ, testo) mantenuto da trigger, sinonimi ampliati e frasi ("primo martedì", "ogni due
settimane"), ricerca OR con idf e copertura, rinforzo dalle FAQ, ripiego trigrammi; con l'AI passaggio di pianificazione sull'indice
completo (fino a 10 sezioni) unito alla ricerca, risposta sul testo integrale di 12 sezioni + 8 FAQ; esito nuovo PARZIALE; senza AI i passi
già scritti. Pagina Guida con filtro "Per chi configura GIPO" e badge fonte/back-end; Redazione con "Rigenera risposta" e "Segna come
risolta dalla guida". Test `server/test/gipoguida-domande.test.mjs` (32 domande reali di back-end, tutte trovano la sezione attesa),
script `server/scripts/gipoguida-domande.mjs`; PDF di 123 pagine. Dettagli e tabella di confronto con il manuale in docs/GIPO_GUIDA.md.

## 13/11/2026 · v0.72.0 · Rimborso Spese (nota spese mensile e rimborso chilometrico)
Richiesta del CEO del 13/11/2026: nuovo modulo nativo **Rimborso Spese** (chiave `rimborsi`, area People dopo il Piano Ferie) accessibile
**solo ai dipendenti** (nuova regola `SOLO_DIPENDENTI` in routes/core.js e `isDipendente` in lib/access.js: persona DIPENDENTE ATTIVO o
IMPEGNO, interna; né LP, né medici, né esterni, né amministratori non dipendenti; nessun grant, ruoli calcolati: responsabile
dall'organigramma, P&C dal grant ADMIN di Contratti o dalle impostazioni, titolare). Nota mensile con le due sezioni del MOD025 (spese) e
del MOD029 (chilometri, pedaggi, parcheggi) nella stessa scheda, riepilogo con saldo a favore del dipendente o dell'azienda (anticipi,
carta aziendale e fuel card non rimborsabili), giustificativi dal telefono con compressione nel browser e archivio a due vie, obbligatori
salvo le eccezioni del CEO (seme per cognome solo se univoco, D58), flusso BOZZA → INVIATA → APPROVATA (righe escluse) / respinta →
IN_LIQUIDAZIONE → LIQUIDATA → ARCHIVIATA con PDF definitivo, nessuno approva la propria, risalita se il responsabile è assente, vertice a
P&C, finestra di invio (giorno 10), doppioni, date fuori mese e future bloccate, job `rimborsi:promemoria`, PDF che riproduce i due moduli
con le firme come attestazioni elettroniche, ZIP, export Excel, archivio, D59, scadenzario di direzione, conto economico di Finance
(note liquidate nella riga del personale), ricerca globale delle proprie note, contatore in Home. Modulistica cartacea TD-SGI-MOD025 e
MOD029 rev. 00 copiata come risorsa e scaricabile da ogni pagina. **Contratti del personale**: sezione "Benefit: vettura e fuel card" nella
scheda della persona (solo P&C e titolare; migrazione contracts 021, PIN mai salvato, numero mascherato, voce aggiunta al benefit del
contratto). Nessuna tariffa né massimale inventati (vuoti), nessun dato reale nel seme. Test `server/test/rimborsi.test.mjs`; collaudo su db
proprio con persone inventate; schermate `docs/screens/rimborsi-*.png`. Prima della consegna, due richieste del CEO: la nota del **vertice** è approvata automaticamente alla conferma, e a ogni approvazione il
**PDF della nota** parte da people@ verso i destinatari esterni di Impostazioni (consulente: seme Poggiali e Caiani), con esito,
reinvio e oggetto "(aggiornata)" sulle riapprovazioni; un errore d'invio non annulla l'approvazione (migrazione rimborsi 002). Da fare:
inserimento di vetture, fuel card e tariffe ACI da parte del CEO e di P&C, verifica delle eccezioni (D58), autorizzazione di people@ per
Mail.Send. Dettagli in docs/RIMBORSI.md.

## Checklist per un nuovo ambiente (L17)
1. Variabili obbligatorie: `DATABASE_URL`, `SESSION_SECRET` (in produzione l'avvio si ferma senza), `BASE_URL`, `NODE_ENV=production`.
2. `CREDENTIALS_KEY` (generata da Render) e, se Business arriva dall'app originale, `BUSINESS_CREDENTIALS_KEY` uguale a quella di
   td-business: in produzione senza chiave le credenziali dei portali di Business sono disattivate (mai la chiave di sviluppo).
3. Entra (`ENTRA_*`), posta (`GRAPH_*`, altrimenti `MAIL_PROVIDER=log`: le password provvisorie tornano all'amministratore), Azure Blob
   (`AZURE_STORAGE_*`, senza le rotte `/api/files` rispondono 503), Anthropic (facoltativa).
4. Primo avvio: migrazioni core e seed del titolare (`SEED_OWNER_*`, cambio password obbligatorio e presa d'atto delle informative).
5. Moduli FRESH: Amministrazione > Travaso moduli > Avvia. **Finance Management (finance) e Spedizioni (shipments) non sono FRESH**: in un ambiente
   nuovo rispondono "Sorgente non collegata" finché non si collega il database dell'app originale (`LEGACY_FINANCE_DATABASE_URL`,
   `LEGACY_SHIPMENTS_DATABASE_URL`) e si fa il travaso; fino ad allora le loro API rispondono 503 "Modulo non ancora travasato".
6. Impostazioni da verificare: `accounts.domini_automatici` (predefinito: i domini di `AUTO_INTERNAL_DOMAINS`), profilo Default
   (Amministrazione > Profili di accesso), conservazione dei PDF dei referti esterni (Referti esterni > Impostazioni, 24 mesi), versioni
   delle informative (Impostazioni > Informative).
7. Il set dimostrativo di Retail in produzione si carica o rimuove solo dal titolare, scrivendo il testo di conferma.
