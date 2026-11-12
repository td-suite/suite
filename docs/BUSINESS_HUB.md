# Business Hub

Richiesta del CEO del 06/11/2026: il widget "Contratti B2C/B2B" diventa **Business Hub**, "la centrale di registrazione del business":
pipeline per fasi, ogni contatto e cosa ci si dice, criticità del laboratorio, non conformità e ordini del cliente, email inviate e
ricevute dalle caselle di linea. Il contratto e l'autorizzazione sanitaria sono un "di cui" del percorso. La chiave del modulo resta
`business` (route `/business`, API `/api/business`, schema `business`, grant e profili invariati); nome e descrizione cambiano nel
catalogo (seed/modules.js e migrazione core 041), icona `business-hub`.

## Modello (migrazione business 008_business_hub.sql)
- `accounts`: uno per Legal entity e linea (`UNIQUE (organization_id, linea)`, linee SRV service di laboratorio, PP punti prelievo,
  MDL medicina del lavoro). Dati commerciali del DB Opportunità (gruppo, tipologia, segmento, discipline, accreditamento, fatturato della
  struttura o il suo testo, fornitore e situazione, listino, priorità e sua fonte, stato cartella), fase corrente 0..7 con le date di fase
  (`phase_dates`), owner (persona interna, riceve le notifiche), prossima azione e data, valori economici (sconto medio come frazione,
  volume, prezzo medio, fatturato FY atteso, 2026, 2027), `prospect`, **cliente attivo** (`cliente_attivo`, `attivo_dal`,
  `attivo_da_user`, `attivo_nota`), note, fonte del censimento, strutture del gruppo (`sedi`), `import_key` e righe originali del file
  (`import_raw`). Anagrafica (ragione sociale, indirizzo, email, PEC, telefono, P.IVA) solo nella Legal entity.
- `contatti`: referenti del cliente (nome, ruolo, email, telefono, principale, note, fonte), collegati a `public.people` della stessa Legal
  entity quando la persona c'è (per `person_id` o email), senza duplicarla. Le persone della Legal entity si "collegano" dalla scheda.
- `activities` (diario): CHIAMATA, EMAIL_IN, EMAIL_OUT, INCONTRO, SOPRALLUOGO, NOTA, OFFERTA, CRITICITA, SISTEMA; quando, chi, con chi,
  oggetto, cosa ci siamo detti, esito, prossima azione, collegamenti (contratto, NC, ordine, ticket), dati email (message id, id Graph
  univoco, mittente, destinatari, copie, esito INVIATO/REGISTRATO/FALLITO/RICEVUTO), fase da/a per gli avanzamenti.
- `criticita`: manuali (origine LABORATORIO, CLIENTE, LOGISTICA, AMMINISTRAZIONE, ALTRO; gravità BASSA..CRITICA; apertura, chiusura con
  esito). Le NC del widget NC compaiono accanto in sola lettura, mai copiate.
- `documenti`: allegati del diario, delle email ricevute e caricamenti manuali (archivio del modulo: Azure Blob o database).
- `email_in`: ogni messaggio letto dalle caselle (abbinato, da assegnare, ignorato). `contract_revisions`: revisioni delle proposte.
  `avvisi_inviati`: notifiche già mandate.

## Fasi e regole
0 Prospect censito (nessuna data), 1 Lead, 2 Primo contatto, 3 Sopralluogo, 4 Offerta inviata, 5 In negoziazione, 6 Contratto firmato,
7 Attivo / Starting. La fase corrente è l'ultima con una data (come la colonna "Fase Attuale" del DB). Regole pure in
`server/src/modules/business/lib/hub.js`, coperte da `server/test/business-hub.test.mjs`.
- **Cliente attivo: lo dice il CEO.** Solo l'Owner della Suite o un Admin del modulo (`PUT /hub/accounts/:id/attivo`). Contratti,
  autorizzazioni, cambi di stato e import non lo toccano. La fase 7 richiede il cliente attivo: senza, la fase resta 6 anche se la data
  della fase 7 c'è (nel DB). Confermare porta a fase 7 con la data indicata e chiude le attività "da confermare"; togliere rimuove la data
  della fase 7 (resta nel diario).
- **Avanzamento**: trascinando la scheda nella Pipeline o con "Cambia fase" si registra la data della fase di arrivo (oggi per default) e
  un'attività SISTEMA con fase da/a; andando indietro le date successive si tolgono e restano nell'attività.
- **Stallo**: fasi 1-6 senza avanzamenti da più di `hub_stallo_giorni` (45); chi ha la data di Attivo / Starting in attesa della
  conferma del CEO non è in stallo (come l'"Alert stallo" del DB).

## Pagine (`web/src/modules/business/pages`)
Cruscotto (`HubCruscotto.jsx`: funnel per fase con conteggi e fatturato FY atteso, stalli, prossime azioni scadute e a 7 giorni,
attività degli ultimi 7 giorni, criticità aperte, NC aperte e ordini in attesa di risposta sui clienti attivi, clienti da confermare dal
CEO, email da assegnare; filtro per linea), Pipeline (`Pipeline.jsx`: kanban con i prospect censiti ripiegati e le 7 fasi, filtri linea,
priorità, owner, provincia, segmento, stato e ricerca), Clienti e prospect (`Clienti.jsx`, tabella ordinabile, nuovo prospect),
DB Opportunità (`Opportunita.jsx`), Scheda account (`Account.jsx`), Email da assegnare con registro invii (`EmailDaAssegnare.jsx`).
Menu (richiesta del CEO del 06/11/2026, `web/src/modules/business/meta.js`): **Management** (Panoramica contratti, Tutti i contratti,
Organizzazioni e sedi), **Service di Laboratorio** (Cruscotto e Pipeline filtrati con `?linea=SRV`, dalla pagina "Tutte le linee"; Clienti
e prospect, DB Opportunità, Email da assegnare, **Clienti** = clienti della linea), **Punti Prelievo** (Punti Prelievo: dal 06/11/2026 l'elenco dei punti
prelievo, vedi "Processo Punti Prelievo", con "Fascicoli autorizzazione", cruscotto e pipeline PP e i Contratti PP; Sedi TD in locazione), **Medicina del Lavoro** (pagina con i
collegamenti a cruscotto e pipeline MDL), **Amministrazione** (Impostazioni, Registro attività). Una voce con `to` che inizia per "?"
resta sulla pagina principale del modulo con il filtro nell'indirizzo (`components/Shell.jsx`).

Scheda account: intestazione con linea, fase e date di fase, cliente attivo (interruttore solo per CEO/Admin), owner, prossima azione;
schede (ordine dal 07/11/2026, vedi "Contratto nella scheda del cliente") Diario ("Registra contatto": tipo, quando, con chi, cosa ci siamo
detti, esito, prossima azione, contratto, allegati), Referenti, **Contratto**, Listino e offerta, Kit e contrattualizzazione, Criticità
(manuali + NC), Ordini, Non conformità, Ticket, Circolari, Portale, Fascicoli (di cui), Documenti, Email ("Scrivi al cliente"), Pacchetto
di benvenuto, Dati economici, Dati commerciali con le strutture del gruppo. Punti Prelievo: Diario, Referenti, Contratto, Punto prelievi,
Criticità, ...; Medicina del Lavoro: come il Service.

## Proposte modificabili (AgapeLab)
Perché il CEO non trovava "nessun modo per modificare" la proposta di AgapeLab: il contratto è arrivato dai pacchetti in stato ATTIVO e
la scheda mostrava "Modifica" e "Rigenera" solo in BOZZA e PROPOSTA (il server rifiutava la PUT con "Il contratto è già firmato"); in più
alla Legal entity mancava il firmatario, quindi la generazione rispondeva "Dati incompleti". Ora:
- BOZZA e PROPOSTA: "Modifica" e "Rigenera DOCX e PDF" come prima (chi gestisce la linea).
- FIRMATO, AUTORIZZATO, ATTIVO: un Admin del modulo usa "Modifica (nuova revisione)" con un **motivo obbligatorio**: la versione
  precedente va in `contract_revisions` (dati e motivo), la versione cresce, lo stato non cambia; "Genera documento vN" produce i nuovi
  DOCX e PDF lasciando quelli delle versioni precedenti. Cessati e annullati non si modificano.
- Dal 07/11/2026 (vedi "Lettera di offerta sempre fresca"): finché il contratto non ha un file FIRMATO caricato, oltre la proposta
  "Rigenera DOCX e PDF" rigenera la versione corrente senza revisione; la revisione serve solo con il firmato caricato.
- "Cambia stato" (Admin del modulo o Owner): qualunque stato con motivazione obbligatoria (`POST /contracts/:id/stato-manuale`, evento
  STATO_MANUALE). Non cambia il cliente attivo.
- La pagina del contratto porta all'account ("Account nel Business Hub", scheda Contratto) e mostra lo storico delle revisioni; dal
  07/11/2026 la stessa pagina è incorporata nella scheda Contratto dell'account.
- Correzione collegata: la modifica di un contratto conserva le chiavi di `data` che il form non conosce (`data.pipeline` e
  `data.censimento` dei pacchetti); prima la validazione le scartava e una modifica avrebbe cancellato la pipeline del 21/07/2026.

## Caselle di linea (`lib/caselle.js`, `routes/caselle.js`)
SRV service@toscanadiagnostica.it, PP network@toscanadiagnostica.it, MDL mdl@toscanadiagnostica.it (`BUSINESS_MAILBOX_*` prevale).
- Lettura: job `business:inbox` ogni 10 minuti (lib condivisa `server/src/lib/graphInbox.js`), "Leggi ora", "Prova la casella", "Prova
  l'invio" per linea in Impostazioni. Ogni messaggio nuovo (oggetto, anteprima del testo `bodyPreview`, allegati fino a 20 MB) si abbina
  per indirizzo del mittente (referenti, persone e accessi esterni della Legal entity, email e PEC della Legal entity, riferimenti
  service/approvvigionamento di org_ext, strutture del gruppo) e poi per dominio (mai gmail, PEC e simili); a parità vince l'account della
  linea della casella. Abbinato → attività EMAIL_IN e notifica all'owner; altrimenti "Email da assegnare" (assegna, crea prospect, ignora;
  "aggiungi il mittente ai referenti").
- Invio: "Scrivi al cliente" (mittente = casella della linea, destinatari dai referenti o liberi, allegati dai documenti dell'account o
  dei contratti della Legal entity, massimo 25 MB) con **riepilogo prima dell'invio** (mittente, destinatari, copie fisse, allegati,
  avvisi) e conferma; **copie fisse sempre presenti** (`hub_cc_*`, precisazione del CEO). Esito nel diario (EMAIL_OUT) e nel registro
  invii; riferimento al registro email della Suite (`email_log:<id>`).
- Privacy: nei log del server solo linea, id ed esiti; nel registro email l'oggetto è "Business Hub · account N"; il log in modalità
  registro di `lib/mailer.js` riporta il numero dei destinatari, non gli indirizzi.
- Collaudo senza Graph: `POST /api/business/inbox/simula` (multipart: linea, from_email, from_name, subject, testo, file) solo con
  `NODE_ENV` diverso da production.

## Pacchetto di benvenuto (`lib/pacchetto*.js`, `routes/pacchetto.js`, scheda account "Pacchetto di benvenuto")
Richiesta del CEO (06/11/2026): "Voglio mandargli l'offerta in un unico pacchetto [...] TUTTO! Rendimi unico sul mercato!" + "Aggiungi
poi l'invio del pacchetto verso il cliente o il punto prelievi". Un unico PDF A4 su carta intestata luglio 2026
(`templates/carta_intestata_2026-07.docx`), con indice, numeri di pagina e segnalibri, generato dalla scheda account e inviato dalla
casella della linea.
- **Sezioni** (ordine di stampa, regola pura `componiSezioni`): copertina (titolo, cliente, data, linea, a cura di = owner, destinatario,
  QR a `suite.toscanadiagnostica.it/service`, o alla Suite per PP e MDL), indice, lettera di benvenuto a firma del CEO, lettera di
  offerta, Il Portale Service (solo SRV) / La rete Toscana Diagnostica (solo PP: sedi attive dell'anagrafica per tipologia) / La
  Medicina del Lavoro (solo MDL), Accesso al Portale (alla Suite per PP e MDL), I primi 30-60-90 giorni, Il vostro referente dedicato,
  Cosa ci rende diversi, Checklist per iniziare, Vademecum degli esami (solo SRV, in coda). Copertina e indice sono fisse; le altre si
  escludono con le spunte. Una sezione senza dati si omette e il motivo compare nella composizione e nell'indice.
- **Offerta**: il PDF generato (`contract_files` GENERATO_PDF, ultima versione) del contratto della linea non annullato né cessato (MOD230
  service, MOD231 MdL, contratto del punto prelievi), inserito con le sue pagine; il suo numero di pagina si copre con quello del
  pacchetto. Senza PDF: pagina "Offerta economica" con i soli dati della proposta presenti nell'account (listino, sconto medio se sotto
  listino, prezzo medio, volume stimato; mai i fatturati attesi, che sono interni). Senza nulla: sezione omessa.
- **Lettera del CEO**: modello per linea in Impostazioni ("Pacchetto di benvenuto · modelli dei testi", `app_settings`
  `pacchetto.lettera_ceo` come JSON { SRV, PP, MDL }, solo le linee modificate; `pacchetto.email` per l'email; "Ripristina i testi
  predefiniti"). Segnaposto `{{cliente}}`, `{{referente}}` (il referente destinatario, o "Cliente"), `{{data}}` (in lettere), `{{owner}}`;
  `{{referenti}}` su una riga da sola = blocco dei contatti. Firma dalle Impostazioni (`lr_name`, `lr_role`: Francesco Epifani, Chief
  Executive Officer). I referenti vengono SOLO da dati presenti: `contatti.json` dello specchio del Portale Service (Laboratorio di
  Analisi, Service Flow & Back Office Manager, Direzione Sanitaria, Direttore tecnico) e Dati aziendali (supporto clienti con orari;
  direttore sanitario come riserva); per PP e MDL la casella della linea al posto del service. Una riga senza recapiti si omette.
- **Portale Service**: schede (Il mio spazio, Preparazioni e documenti, Certificazioni e VEQ, Vademecum, Non conformità, Ordini del
  materiale, Sistema di Gestione della Qualità, Circolari con presa visione, Audit, Ticket, Contatti con il personale, Referti di
  Laboratorio online) scritte dalle Guide dei widget; livello di supporto dai Dati aziendali; SLA solo se definiti nei moduli: NC
  `nc.org_ext.sla_ore` della Legal entity o `sla_ore_default`, Ticket tabella `ticket.sla` (priorità, prima risposta, risoluzione);
  modulo non avviato = "tempi di risposta concordati". Nessuna schermata dell'app.
- **Credenziali**: indirizzo e QR; accessi esterni della Legal entity creati nella Suite (nome, email, profilo di accesso; password
  "provvisoria, inviata via email con l'invito" o "già attiva" se c'è stato un accesso: la Suite non conserva le password provvisorie);
  primo accesso (password provvisoria, nuova password, informative, secondo fattore facoltativo); portale dei referti da
  `portal_credentials` del contratto della linea o da `org_ext` della Legal entity: indirizzo e utente, password SOLO con la spunta
  "Includi la password nel pacchetto" (avviso in pagina, badge "con password" nel registro), altrimenti "comunicata separatamente".
- **Vademecum**: frontespizio su carta intestata (con link e QR al Vademecum online) e poi le pagine del PDF dello specchio del Portale
  Service (`vademecumPdf()` + `leggiFile()`), numerate in alto a destra perché hanno intestazione e piè propri. PDF non disponibile o
  Portale Service non avviato: solo la pagina con link e QR.
- **Idee in più**: piano dei primi 30-60-90 giorni (proposta da concordare, date calcolate dalla data del pacchetto, passi per linea),
  referente dedicato (owner: nome, mansione dalla persona, email, telefono d'ufficio; gli altri contatti senza doppioni), cosa ci rende
  diversi (trasparenza, tempi, certificazioni, un solo portale; tabella delle certificazioni ISO con numero e scadenza da
  `certificazioni.json`), checklist per iniziare (con "restituite firmata" solo se il contratto non è firmato).
- **Impaginazione**: ogni sezione è un DOCX sulla carta intestata (meccanismo di `referti/lib/formatTD.js`: testa e coda del
  `document.xml` del template, corpo generato; margini 4 cm/3 cm, numero di pagina del piè tolto), un solo giro di LibreOffice per tutte
  (`docxToPdfBatch` in `docgen.js`), indice generato dopo con i numeri veri, unione con `pdf-lib` (numerazione, segnalibri, titolo e
  autore del PDF). Font Arial (Liberation Sans): stesso risultato in locale e nell'immagine Docker. Tempo tipico: 5-6 secondi.
- **Lettere di offerta** (correzione collegata, `renderDocx`): margine superiore minimo 3,94 cm (prima il testo delle pagine dopo la
  prima finiva sopra i contatti della carta intestata), intestazione petrolio delle tabelle ripetuta e titolo subito prima della tabella
  tenuto con la tabella. Vale per le offerte generate da ora: le esistenti si rigenerano con una nuova versione.
- **Flusso nel widget**: scheda "Pacchetto di benvenuto": composizione (spunte, referente destinatario, data, password sì/no),
  "Genera anteprima" = nuova versione nei Documenti dell'account (categoria PACCHETTO, nome `AAAA-MM-GG_Pacchetto_benvenuto_<cliente>_vN.pdf`),
  attività PACCHETTO nel diario (sezioni incluse e omesse), registro `pacchetti` (versione, data, pagine, destinatario, sezioni, avvisi,
  password inclusa, invio); anteprima in pagina, "Scarica", "Invia dalla casella della linea": stesso riepilogo e copie fisse di "Scrivi
  al cliente" (`POST /hub/accounts/:id/email/invia` con `documenti=[PDF]` e `pacchetto_id`), oggetto "Toscana Diagnostica · Benvenuto
  {{cliente}}", testo dal modello; esito EMAIL_OUT nel diario e nel registro invii, stato dell'invio nel registro dei pacchetti.
- **Permessi**: composizione e registro per tutti i profili del modulo; generazione e invio per chi gestisce la linea (`canEditKind`);
  modelli dei testi: Admin del modulo. Migrazione `009_pacchetto.sql` (tipo PACCHETTO, categoria PACCHETTO, tabella `pacchetti`).
- **API**: `GET /hub/accounts/:id/pacchetto` (composizione, disponibilità, referenti, versioni, email), `POST /hub/accounts/:id/pacchetto`
  ({ escluse, contatto_id, includi_password, data }), `GET /hub/accounts/:id/pacchetto/email?contatto_id=`, `GET|PUT /hub/pacchetto/modelli`.
- **Test**: `server/test/business-pacchetto.test.mjs` (sezioni per linea, segnaposto, piano, credenziali con e senza password,
  referenti, margini e piè, unione PDF con segnalibri, unione con il Vademecum dello specchio di collaudo se c'è).
- **Collaudo del 06/11/2026** (db di prova, porta 3142, origine finta del Portale Service su 7051): AgapeLab (SRV) 276 pagine (copertina,
  indice, lettera, offerta MOD230 di 20 pagine, portale 2, credenziali, piano, referente, diversi, checklist, frontespizio del Vademecum
  e 244 pagine) in circa 5 secondi, inviato da service@ con le copie fisse (REGISTRATO in modalità registro); versione con password e
  sezioni escluse; ACF Fiorentina (MDL, offerta MOD231) 23 pagine; Maestrale (PP, senza offerta: sezione omessa con il motivo) 10 pagine.
  Un profilo Service non genera sulla linea PP né modifica i modelli. Schermata `docs/screens/hub-pacchetto.png`.

## Feed dagli altri widget (`lib/feed.js`, sola lettura, cache 60 s)
- NC: `nc.nc` con `org_id` della Legal entity o `site_id` dei suoi punti SERVICE e delle sedi che ospita; numero, data, tipo, gravità,
  stato, invio, prima risposta, chiusura.
- Ordini: `orders.orders` della Legal entity o dei suoi punti; richiesta → approvazione (tempo di risposta, operatore) → presa in carico
  → spedizione (DDT) → consegna; in attesa = INVIATO, con i giorni.
- Ticket: "per conto di" la Legal entity o aperti dai suoi utenti (mai i riservati). Circolari: pubblicate nel segmento della linea o
  inviate agli indirizzi del cliente, con prese visione dei suoi utenti. Portale: accessi esterni con ultimo accesso e ultima consultazione.
- Referti esterni: nessun legame con la Legal entity (referti per paziente e mittente email), la sezione non c'è.
- Un widget non avviato risponde "widget non attivo". Il cruscotto conta NC aperte e ordini in attesa sui soli clienti attivi.
- Notifiche in app all'owner (job `business:avvisi` ogni 30 minuti, una volta per evento): NC aperta sul suo cliente, ordine senza
  risposta oltre `hub_ordini_giorni`, prossima azione scaduta; criticità ALTA o CRITICA ed email in arrivo notificano subito.

## Import del DB Opportunità (`lib/opportunita.js`, Impostazioni)
Business Hub > Impostazioni > "Importa DB Opportunità (XLSX)": "Prova (senza scrivere)" mostra il piano (righe, Legal entity, abbinate a
contratto, abbinate a Legal entity, nuove, dubbi tra 72% e 90% con la scelta a mano, gruppi accorpati, righe con alert, clienti da
confermare dal CEO, contratti con differenze); "Importa" esegue. Idempotente: le righe si ritrovano per ID (`legacy_refs.db_opportunita`)
e l'account per Legal entity e linea; ripetere aggiorna i dati commerciali, ma le date di fase già registrate nella Suite, la prossima
azione, l'owner, il diario e il cliente attivo non si toccano.
- Colonne: le 49 del file (mappatura in `COLONNE_DB`); "n.d." resta vuoto con nota nel diario; valori testuali in colonne numeriche (es.
  "Fatturato struttura" del gruppo) restano come testo; Fase Attuale, Ultimo avanzamento, Giorni e Alert stallo si ricalcolano.
- Nel diario (attività SISTEMA di import): Stato Cartella, In Pipeline, Cliente Pipeline, Affidabilità match, Alert riconciliazione,
  Fase Attuale del DB, campi "n.d."; tutto anche in `import_raw`.
- Contratti esistenti (68 service dai pacchetti con `data.pipeline` del 21/07/2026): l'account nasce sulla Legal entity del contratto;
  le differenze tra DB e pipeline del contratto (fase, date, fatturati, prezzo) diventano un'attività SISTEMA "Riconciliazione con il
  contratto ..." da verificare; il contratto non si modifica.
- Cliente attivo: mai dall'import. Le righe con "Toscana Diagnostica" + "Cliente TD attivo" (e quelle con la data della fase 7) danno
  un'attività "Cliente attivo: da confermare dal CEO".
- Gruppi: vedi docs/ANAGRAFICA.md (una Legal entity e un account per gruppo o ente gestore non generico; le strutture in `sedi`, non
  come `public.sites`); volumi e fatturati dell'account di gruppo sono la somma delle righe, i valori di ciascuna riga restano nelle sedi.
- "Account per i contratti già presenti": contratti PP, SRV, MDL con controparte e senza account sulla linea → account con le fasi della
  pipeline del contratto o, in mancanza, proposta = 4 e firma = 6; un contratto ATTIVO diventa "da confermare dal CEO".

## Vista DB Opportunità ed export
`/business/db-opportunita`: le 49 colonne del file (più Linea e Cliente attivo) ricostruite dagli account vivi, ricerca, filtro per
colonna (tendina quando i valori sono pochi), ordinamento, colonne nascondibili (ricordate nel browser), clic sulla riga = scheda account.
Export della selezione corrente (righe filtrate nell'ordine mostrato, colonne visibili): XLSX con exceljs (intestazione colorata, filtri,
riquadri bloccati, foglio "Selezione" con i filtri) e PDF su carta intestata TD con pdfkit (logo, titolo, filtri, piè di pagina dai Dati
aziendali, A3 orizzontale oltre 12 colonne; se le colonne non stanno nella pagina la tabella si divide in blocchi con ID e ragione sociale
ripetuti).

## Permessi
Lettura: tutti i profili del modulo. Scrittura sull'account (fasi, diario, referenti, documenti, email): chi gestisce la linea
(`canEditKind`: ADMIN tutte, SERVICE il service, RETAIL i punti prelievo, MDL la medicina del lavoro); criticità anche HQS. Cliente attivo
e cambio di stato manuale dei contratti: Admin del modulo o Owner. Import, caselle (prove e lettura) ed eliminazione di un account: Admin.
Gli accessi esterni non vedono il Business Hub nemmeno con un grant (403).

## API principali (`/api/business`)
`GET /hub/cruscotto`, `GET|POST /hub/accounts`, `GET|PUT|DELETE /hub/accounts/:id`, `PUT /hub/accounts/:id/fase`,
`PUT /hub/accounts/:id/attivo`, `GET /hub/accounts/:id/feed/{nc,ordini,ticket,circolari,portale}`, `POST /hub/accounts/:id/attivita`,
`DELETE /hub/attivita/:id`, `POST /hub/accounts/:id/contatti`, `PUT|DELETE /hub/contatti/:id`, `POST /hub/accounts/:id/criticita`,
`PUT /hub/criticita/:id/chiudi`, `POST /hub/accounts/:id/documenti`, `GET|DELETE /hub/documenti/:id`,
`POST /hub/accounts/:id/email/anteprima`, `POST /hub/accounts/:id/email/invia`, `GET /hub/invii`, `GET /hub/email/da-assegnare`,
`POST /hub/email/:id/assegna`, `POST /hub/email/:id/ignora`, `GET /hub/utenti`, `GET /hub/opportunita`, `POST /hub/opportunita/export`,
`POST /hub/import/db/prova`, `POST /hub/import/db/esegui`, `GET|POST /hub/accounts/:id/pacchetto`, `GET|PUT /hub/pacchetto/modelli`, `GET|PUT /hub/pacchetto/certificazioni`, `GET /hub/import/db/runs`, `POST /hub/import/contratti`, `GET /hub/caselle`,
`POST /hub/caselle/:linea/prova`, `POST /hub/caselle/:linea/prova-invio`, `POST /hub/caselle/leggi`, `POST /inbox/simula`,
`POST /contracts/:id/stato-manuale`.

## Collaudo del 06/11/2026 (db di prova, porta 3141)
Contratti dei pacchetti caricati senza documenti (70 contratti: 68 service, 2 MDL; 11 PP/SEDE saltati per le sedi TD assenti nel db di
prova), poi il file del CEO (477 righe di dati; le 9 righe di totale e legenda in fondo al foglio non sono dati):
- Prova: 424 unità (29 gruppi con 82 righe), 61 abbinate a un contratto esistente, 5 a una Legal entity esistente, 357 nuove,
  1 dubbio (LAMM/Eurofins ↔ Eurofins Lamm Srl, 78%: deciso "è Eurofins Lamm Srl"), 24 righe con Alert riconciliazione, 18 clienti da
  confermare dal CEO, 24 contratti con differenze.
- Import: 419 account creati, 357 Legal entity nuove (tipo CLIENTE, prospect), 43 referenti, 461 attività di sistema (24 riconciliazioni,
  18 da confermare); seconda esecuzione: 0 creati, 419 aggiornati, nessuna attività doppia.
- Pipeline: 357 prospect censiti, 6 Sopralluogo, 10 Offerta inviata, 27 In negoziazione, 19 Contratto firmato (18 con la data di Attivo /
  Starting in attesa del CEO), 0 Attivi finché il CEO non conferma.
- Scenario su AgapeLab: referente, contatto registrato con allegato, criticità ALTA, email simulata in arrivo abbinata al referente,
  email da mittente sconosciuto assegnata creando un prospect, email in uscita da service@ con le copie fisse (REGISTRATO), NC aperta nel
  widget NC sulla Legal entity → scheda e cruscotto, due ordini (uno approvato e spedito con tempo di risposta, uno in attesa da 5 giorni
  oltre la soglia) → scheda, cruscotto e notifica all'owner, cliente attivo confermato dall'Owner (fase 7), revisione v2 del contratto
  ATTIVO con motivo e documento v2, cambio di stato manuale; proposta PROPOSTA modificata e rigenerata (v2). Permessi: un profilo Service
  non imposta il cliente attivo né cambia lo stato a mano; un accesso esterno riceve 403.
- Schermate: `docs/screens/hub-cruscotto.png`, `hub-pipeline.png`, `hub-account.png`, `hub-db-opportunita.png` (1400x900).

## Da verificare in produzione
- Permessi Microsoft Graph sulle tre caselle (Mail.Read e Mail.Send applicativi, Application Access Policy estesa a service@, network@,
  mdl@): "Prova la casella" e "Prova l'invio" per linea in Impostazioni.
- Il dubbio dell'import (LAMM/Eurofins) e le 24 riconciliazioni con i contratti vanno decisi dal CEO; i 18 "da confermare" pure.
- I contratti PP e la sede SEDE non erano nel db di prova (sedi TD assenti): in produzione "Account per i contratti già presenti" crea i
  loro account.

## Processo Service: da prospect a cliente contrattualizzato (06/11/2026)
Richiesta del CEO: listino StudioLAB per cliente con le versioni, offerta economica in PDF, kit di proposta da service@ con la form online,
contratto firmato in ascolto, comunicazioni automatiche, attivazione dei widget, richiamo periodico dei prospect; "tutto deve essere
registrato". Migrazione `010_service_flow.sql`; regole pure in `lib/listino.js` e `lib/processo.js`, parte operativa in `lib/flusso.js`,
`lib/contrattualizza.js`, `lib/richiamo.js`, `lib/offertaEconomica.js`, `lib/mod173Pdf.js`; route `routes/listino.js`, `routes/processo.js`,
`routes/b2b.js` (pubblica); interfaccia `components/Listino.jsx`, `components/Proposta.jsx`, `components/ProcessoImpostazioni.jsx`,
`pages/ClientiAttivi.jsx`, `web/src/pages/FormB2B.jsx`. Test: `server/test/business-service-flow.test.mjs`.

**1. Listino e offerta** (scheda account "Listino e offerta"). Carico dell'Excel esportato da StudioLAB (.xlsx o .csv) sempre con
l'anteprima: la riga di intestazione si cerca nelle prime 20 righe, le colonne si riconoscono con i sinonimi (codice esame, descrizione,
settore/sezione/branca, prezzo di listino/tariffa, prezzo offerto/scontato/netto, sconto %, unità, note); numeri all'italiana, sconto in
percentuale o in frazioni, prezzo offerto o sconto ricavati l'uno dall'altro, righe vuote e di totale scartate. Il formato esatto di
StudioLAB non era disponibile: se le colonne indispensabili (descrizione e prezzo di listino) non si riconoscono si scelgono a video e il
mapping si salva (`listino.mapping`) per i caricamenti successivi. Ogni salvataggio è una versione (`listini`: v1, v2, ... con nota,
righe in jsonb, riepilogo, differenze con la versione corrente: righe cambiate evidenziate, aggiunte, tolte, sconto medio prima e dopo);
la corrente è l'ultima salvo scelta ("Rendi corrente") e lo sconto medio dell'account la segue. Sconto medio = 1 − Σofferta/Σlistino
(ponderato), accanto la media semplice (uso interno). Da ogni versione "Offerta economica" in PDF sulla carta intestata luglio 2026
(contenuto dal 07/11/2026: vedi "Offerta economica: contenuto"), nei Documenti dell'account (categoria OFFERTA_ECONOMICA). Diario:
LISTINO, OFFERTA_ECONOMICA. Revisione in pagina: vedi "Listino: revisione".

**2. Proposta al cliente** (scheda "Kit e contrattualizzazione", fino al 07/11/2026 "Proposta e contratto"). Checklist: listino caricato, referente con email, dati del cliente completi
(ragione sociale, P.IVA, indirizzo, città, email o PEC), credenziali StudioLAB (contratto della linea o Legal entity), accesso alla
Suite (si crea da solo alla preparazione o con "Crea accesso"), offerta economica della versione corrente, lettera di offerta MOD230
generata. Con tutto verde "Prepara la mail": accesso creato se manca, collegamento alla form, **pacchetto della proposta** (variante KIT
del pacchetto di benvenuto: lettera di presentazione e invito modificabile in Impostazioni, lettera di offerta, **Offerta economica dal
listino**, Portale Service, accesso alla Suite, **Credenziali StudioLAB** (password solo con la spunta), piano, referente, diversi,
checklist, Vademecum con le pagine o solo link e QR), MOD173 compilabile precompilato, circolare per il trasporto dei campioni
(`templates/circolare_trasporto_campioni_2003-05-08.pdf`, allegata come "Allegato 3 - Circolare Ministero 8 Maggio 2003.pdf", Allegato 4 fino al 07/11/2026). Anteprima
con mittente, destinatari, copie fisse, allegati con le dimensioni, oggetto e testo modificabili; "Invia da service@" con conferma.
All'oggetto si aggiunge sempre il riferimento `[TD-B2B-xxxxxxxxxx]` (prime 10 lettere del token) che abbina la risposta. Con l'invio:
EMAIL_OUT sottotipo KIT_PROPOSTA nel diario e nel registro invii, `kit_proposta` INVIATO, pipeline alla fase 4 con la data di oggi.
Idempotenza: un secondo invio per la stessa versione del listino risponde 409 e chiede "Sì, invia di nuovo". Avviso oltre 3 MB di
allegati (da verificare con "Prova l'invio"), blocco oltre 25 MB.

**3. Accesso alla Suite prima della firma**. Persona ESTERNO della Legal entity e utente LOCAL esterno **senza grant**: per
`esternoInAttesa` (lib/esterni.js) la Home non mostra nessun widget, nemmeno quelli aperti a tutti (Portale Service, SGI, Circolari,
Ticket: `requireModuleReady` risponde 403 "Accesso in attivazione"), con il messaggio "Accesso in attivazione". L'invito con la password
provvisoria parte da service@ **senza copie** (credenziali personali), nel diario resta una nota senza la password (sottotipo
INVITO_SUITE); con la posta in modalità registro la password torna solo a chi preme "Crea accesso".

**4. Form online pubblica** `/b2b/<token>` (nessun login; API `/api/business/b2b/:token` montata prima della sessione, modulo LIVE,
30 invii ogni 15 minuti per IP, file fino a 10 MB, intestazione anti CSRF). Token per account (24 byte casuali), scadenza
`hub_b2b_token_giorni`, "Rinnova" (stesso link) o "Nuovo collegamento" (il vecchio non vale più). La pagina mostra l'Anagrafica Clienti
B2B (tutti i campi del TD-SGI-MOD173, precompilati da Legal entity, org_ext, referente principale e indirizzo del laboratorio, o
dall'ultimo invio), il caricamento del contratto firmato (PDF, oppure "lo invio per email") e gli allegati configurati in Impostazioni.
Ogni invio: `anagrafiche_b2b` (versione, dati, IP), MOD173 compilato in PDF nel fascicolo (categoria MOD173), file nei documenti
(CONTRATTO_FIRMATO, ALLEGATO_CONTRATTO), attività FORM_B2B. I campi vuoti della Legal entity (`public.organizations`: P.IVA, SDI, PEC,
indirizzo, IBAN, banca...) e di `org_ext` (servizi, riferimenti, condizioni di pagamento) si riempiono da soli; quelli già valorizzati e
diversi diventano proposte nella scheda ("Applica i campi scelti"). Con il contratto firmato parte la contrattualizzazione.

**5. Ascolto della casella**. Il job `business:inbox` (e la simulazione) riconosce il riferimento `[TD-B2B-...]` nell'oggetto anche da un
mittente sconosciuto; per gli account con il kit inviato o il collegamento attivo gli allegati PDF diventano "da verificare" (badge
"Clienti", riquadro in cima a "Kit e contrattualizzazione") e l'email è una "Risposta del cliente" (sottotipo RISPOSTA_KIT). Un clic: "È il
contratto firmato" (contrattualizzazione), "Allegato del contratto", "Non pertinente". Anche un PDF caricato a mano nei Documenti si
conferma come contratto firmato.

**6. Contrattualizzazione** (`lib/contrattualizza.js`, una volta sola: `contrattualizzato_at`; un secondo contratto va nel fascicolo e
nel contratto senza ripetere le comunicazioni): contratto della linea FIRMATO con la data e il PDF tra i suoi file (evento nel contratto),
pipeline alla fase 6; attivazione: profilo di sistema **Cliente service** (Portale Service, SGI, NC, Ordini, Circolari, Rubrica; Ticket è
aperto a tutti) in merge sugli accessi esterni della Legal entity (se non c'è un accesso si crea per il referente), nuovo invito a chi
non è mai entrato, attività ATTIVAZIONE con gli avvisi (senza sede SERVICE "Il mio spazio", NC e Ordini restano senza ambito: creare la
sede e "Riallinea perimetri", poi "Riapplica i servizi agli accessi"); poi da service@ con le copie fisse: **"Avvenuta
contrattualizzazione: <cliente>"** a `hub_dest_contrattualizzazione` (riepilogo, PDF firmato allegato), **ringraziamento e benvenuto**
al referente (Suite, servizi, accessi attivi, come entrare, referenti dallo specchio del Portale Service e dai Dati aziendali), **"Nuovo
cliente contrattualizzato"** a `hub_dest_laboratorio` (volumi giornalieri attesi dal campo dell'account o volume FY / giorni lavorativi,
data di avvio prevista, referente, listino, offerta economica allegata). Esito in `accounts.contrattualizzazione` e nella scheda; la fase 7
resta al CEO. Diario: CONTRATTO_FIRMATO, ATTIVAZIONE, EMAIL_OUT CONTRATTUALIZZAZIONE / BENVENUTO / NUOVO_CLIENTE_LAB.

**7. Richiamo dei prospect** (`lib/richiamo.js`, job `business:richiamo-prospect`). Account SRV in fase 0-5, non clienti né
contrattualizzati, senza "Non contattare" (scheda "Kit e contrattualizzazione", Avvio del cliente), con un'email (referente principale o Legal
entity), senza richiami né altre email inviate negli ultimi `hub_richiamo_giorni`; prima chi non è mai stato richiamato, poi il richiamo
più vecchio, poi la priorità; massimo `hub_richiamo_limite` al giorno (contano anche gli invii a mano). Email da service@ con le copie
fisse (modello in Impostazioni: azienda, servizi, Portale Service, invito a rispondere a service@ e al primo indirizzo dei recapiti,
recapiti da anagrafica) con il **pacchetto di presentazione** (variante PROSPECT: lettera di presentazione, Portale Service, referente se
c'è l'owner, diversi, Vademecum come link e QR; senza offerta né credenziali). EMAIL_OUT RICHIAMO e `ultimo_richiamo_at`. Interruttore
spento di default; anteprima "chi riceverebbe il richiamo oggi" nel Cruscotto; "Esegui ora" in Impostazioni (solo acceso).

**Pagina "Clienti"** (`/business/clienti-attivi`): clienti attivi (confermati dal CEO) e contrattualizzati in avvio della linea, con
contratto, avvio (attivo dal o prevista), volumi giornalieri, listino, accessi, ultimo contatto, owner, allegati da verificare.

**API** (`/api/business/hub`): `GET /accounts/:id/listini`, `POST /accounts/:id/listini/anteprima` e `/accounts/:id/listini` (multipart
file, mapping, foglio, note), `GET /listini/:id`, `PUT /accounts/:id/listino-corrente`, `POST /listini/:id/offerta`,
`GET|DELETE /listino/mapping`, `GET /accounts/:id/processo`, `POST /accounts/:id/accesso`, `POST /accounts/:id/b2b-link`,
`POST /accounts/:id/kit/prepara`, `GET /kit/:id`, `POST /kit/:id/invia`, `POST /kit/:id/annulla`, `POST /documenti/:id/verifica`,
`POST /accounts/:id/contrattualizza`, `POST /accounts/:id/attiva-accessi`, `POST /anagrafiche/:id/applica`, `GET /clienti-attivi`,
`GET /richiamo/anteprima`, `POST /richiamo/esegui`, `GET|PUT /flusso/modelli`, `GET|PUT /b2b/allegati`. Pubbliche:
`GET|POST /api/business/b2b/:token`, `GET /api/business/b2b/:token/mod173.pdf`. Badge del menu `da_verificare`.

**Privacy e testi**: nei log del server solo id ed esiti; nessun nome, numero o impegno inventato: i testi vengono dai modelli con
segnaposto (una riga con i segnaposto tutti vuoti non compare), i recapiti dall'anagrafica, i volumi e le date dall'account.

**Collaudo del 06/11/2026** (db di prova `suite_srv_t`, porta 3143, origine finta del Portale Service su 7052, posta in modalità
registro; moduli business, service, nc, orders, circolari, ticket avviati; DB Opportunità importato: 424 account). Prospect di prova
"Laboratorio Analisi Collaudo S.r.l.": listino di 30 esami con titolo e intestazioni "Cod. Prestazione / Descrizione Prestazione / Branca /
U.M. / Tariffa Listino € / Sconto % / Prezzo Netto € / Note" riconosciuto da solo (riga 4, 2 righe di totale scartate), v1 sconto 10%,
v2 "sconto richiesto dal cliente" 9 righe cambiate, sconto medio 10% → 16,8%; offerta economica v2 di 4 pagine in circa 2 secondi;
proposta MOD230 generata; kit preparato in 7 secondi (pacchetto della proposta di 281 pagine con il Vademecum, 4,5 MB di allegati),
inviato (REGISTRATO) a referente con le copie fisse, fase 4. Accesso esterno: prima della firma Home vuota "Accesso in attivazione",
Portale Service e Circolari 403. Form pubblica compilata (SDI, banca, IBAN, condizioni) con il PDF firmato: anagrafica v1, MOD173
compilato nel fascicolo, 8 campi vuoti completati, 1 differenza proposta (termine di pagamento), contratto SRV-2026-0001 FIRMATO con il
PDF, fase 6, profilo Cliente service (6 widget), tre email REGISTRATE (interna a Francesco Epifani e Rosetta Greco; benvenuto al
referente in cc alle copie fisse; laboratorio@ e valentina.zezza@ in cc alle copie fisse, "circa 120 esami al giorno"); dopo la firma
l'esterno vede Portale Service, SGI, NC, Ordini, Circolari, Ticket, Rubrica. Risposta per email con il riferimento da un mittente
sconosciuto: abbinata, allegato da verificare, registrato come "Visura camerale". Richiamo: spento 400; acceso con limite 3: tre
presentazioni di 9 pagine inviate in circa 10 secondi, seconda esecuzione 0 (limite giornaliero). Schermate `docs/screens/hub-listino.png`,
`hub-kit.png`, `hub-form-b2b.png`, `hub-menu.png`.

**Da verificare in produzione**: formato reale dell'Excel esportato da StudioLAB (al primo caricamento: colonne riconosciute o mapping a
video); invio da service@ con allegati di qualche MB (il kit con il Vademecum supera i 3 MB: "Prova l'invio" e, se Graph rifiuta,
Vademecum come link); permessi Graph Mail.Read/Mail.Send sulla casella service@; dominio pubblico del collegamento alla form (BASE_URL
https); sede SERVICE della Legal entity da creare all'avvio per "Il mio spazio", NC e Ordini.

## Processo Punti Prelievo (06/11/2026)
Richiesta del CEO: "Il processo Punti Prelievo lo vedi così: Anagrafica: il punto prelievi può essere un flagship (cioè in sede in
locazione) o un corner (in sede di terzi, ovvero il partner). Contratto: quando il punto è in sede di terzi [...] il contratto viene
inviato da network@ alla sede che ospita il punto prelievi. Una volta firmato [...] il widget ascolta la mail e aggiorna il fascicolo [...];
alternativa permette l'upload del pdf [...]. Non appena caricato, il widget scrive al partner inviando le credenziali della suite esponendo
il widget Cash [...], a francesco.epifani@ e silvia.sansoni@ [...], a laboratorio@ e valentina.zezza@ [...], induce in widget Ordini il
primo ordine standard [...], scrive a valentina.zezza@ [...], a amministrazione@ [...], a iacopo.cupelli@ [...]". Stessa meccanica e stesso
stile del processo Service, parametrizzati per linea: token e form pubblica (variante PARTNER), invio dalla casella della linea con le
copie fisse e registrazione, ascolto con il riferimento `[TD-B2B-...]`, verifica con un clic, contrattualizzazione idempotente.
Migrazione `011_pp_flow.sql`; regole pure in `lib/processo.js` (sezione Punti Prelievo), parte operativa in `lib/puntoPrelievi.js`, ramo PP di
`lib/contrattualizza.js`, route in `routes/processo.js`; interfaccia `components/PuntoPrelievi.jsx` (scheda "Punto prelievi"),
`pages/PuntiPrelievo.jsx`, cruscotto, `web/src/pages/FormB2B.jsx` (variante PARTNER). Test: `server/test/business-pp-flow.test.mjs`.

**1. Anagrafica del punto (account PP).** Un account per punto prelievi: l'unicità per Legal entity e linea resta per Service e MdL; per i
Punti Prelievo vale per sede (`pp_site_id`, una sede un solo account) o per nome (`pp_nome`), così un partner può ospitare più corner e la
società TD avere più flagship. **Flagship o corner non è un campo nuovo**: si deriva dalla sede TD collegata (`public.sites`, tipo
PUNTO_PRELIEVI): titolo di godimento OSPITATA (o, senza titolo, una Legal entity ospitante) = corner; proprietà, locazione o comodato senza
ospitante = flagship (il comodato è una sede TD: scelta documentata). Senza sede vale il "tipo previsto" (`pp_tipo_previsto`), da
confermare al collegamento della sede; se la sede dice altro vale la sede (avviso). Per il corner l'account sta sulla Legal entity del
partner (deve coincidere con l'ospitante della sede); per il flagship sulla Legal entity della sede (la società TD) o su quella scelta.
Date di avvio prevista (`data_avvio_prevista`) ed effettiva (`data_avvio_effettiva`). La scheda "Punto prelievi" (al posto di "Listino e
offerta" e "Kit e contrattualizzazione", che restano del Service) mostra tipo, sede, partner ospitante, referente del partner (referente
principale), date, fascicolo di autorizzazione (della sede, altrimenti del contratto PP) e contratto PP o locazione della sede (SEDE), con i
pulsanti "Fascicolo di autorizzazione" e "Scheda Sede in Amministrazione". Pagina **Punti Prelievo** (`/business/punti-prelievo`): elenco con
tipo, sede, partner, fase, contratto o locazione, autorizzazione (stato del fascicolo), avvio (date e passi), filtro corner/flagship; sedi
Punto prelievi dell'anagrafica senza account con "Crea il punto prelievi" (Legal entity = ospitante per il corner, Legal entity della sede
per il flagship); "Nuovo punto prelievi" senza sede (nome, tipo previsto, Legal entity); collegamenti a Fascicoli autorizzazione, cruscotto e
pipeline PP, Contratti PP (`/business/contratti-pp`, prima su `/punti-prelievo`). L'import "Account per i contratti già presenti" crea un
account PP per Legal entity e sede del contratto.

**2. Contratto al partner (solo corner).** Prerequisiti: punto corner, contratto PP generato (BOZZA o PROPOSTA con il PDF generato, "il
contratto che ha in memoria": template `contratto_punto_prelievi.docx`), referente del partner con email. "Invia il contratto al partner da
network@": stessa tabella e stessa anteprima del kit (`kit_proposta.variante = CONTRATTO_PARTNER`, contratto e PDF collegati): mittente
network@, copie fisse Francesco Epifani e Silvia Sansoni, PDF del contratto, riferimento `[TD-B2B-xxxxxxxxxx]` sempre nell'oggetto,
collegamento alla form del partner, testo dal modello "PP · contratto al partner"; invio con conferma, un secondo invio dello stesso PDF
risponde 409 e chiede "Sì, invia di nuovo". Con l'invio: EMAIL_OUT sottotipo CONTRATTO_PARTNER nel diario e nel registro invii, evento
INVIATO nel contratto, pipeline alla fase 4.

**3. Ascolto, form del partner e fascicolo.** La form pubblica `/b2b/<token>` per un account PP è la **variante PARTNER**: dati del
referente (nome, ruolo, email, telefono, note) e caricamento del contratto firmato (o "lo invio per email"), senza MOD173 (il PDF del MOD173
risponde 404). Il referente si aggiorna (stessa email) o si aggiunge come principale; ogni invio resta in `anagrafiche_b2b`
(`dati.variante = PARTNER`) con l'attività FORM_B2B. La risposta a network@ con il riferimento (anche da un mittente sconosciuto) porta gli
allegati PDF "da verificare" in cima alla scheda: un clic "È il contratto firmato". In alternativa "Carica il PDF firmato (ricevuto per
altri canali)" (`POST /hub/accounts/:id/contratto-firmato`, vale per ogni linea). Al contratto firmato (una volta sola,
`contrattualizzato_at`; un secondo PDF va nel fascicolo e nel contratto senza ripetere nulla): documento CONTRATTO_FIRMATO dell'account,
contratto PP FIRMATO con il PDF tra i suoi file, PDF anche nel **fascicolo di autorizzazione** come "disponibilità dei locali (contratto con la
struttura ospitante)" se il fascicolo c'è, pipeline alla fase 6, poi l'avvio.

**4. Avvio del punto prelievi** (passi a-g, regola pura `pianoAvvio`, esecuzione `eseguiAvvio`): ogni passo ha stato (fatto, non riuscito,
in attesa della data, in attesa della sede), esito, data, destinatari e attività nel diario; un passo riuscito **non si ripete mai**; un
passo non riuscito non ferma gli altri e aspetta "Riprova" (per riga o per tutti, dalla scheda e dal cruscotto). Tutte le email da network@
con le copie fisse; destinatari interni e testi in Impostazioni (modelli "PP ·" con segnaposto, nessun nome, prezzo o fornitore scritto nel
codice).
- a) solo corner: profilo di sistema **Partner ospitante** (`PARTNER_OSPITANTE`: Cash in sola visualizzazione delle royalties delle sedi
  ospitate, più circolari e rubrica come già previsto dal profilo) in merge sugli accessi esterni della Legal entity; se non ce n'è uno si
  crea per il referente (persona ESTERNO, utente LOCAL esterno) con l'invito e la password provvisoria **senza copie** (nel diario solo una
  nota, come per il Service); invito a chi non è mai entrato (mai due inviti alla stessa persona); poi l'email di benvenuto (cosa vede:
  royalties mensili; servizi attivi dal profilo; accessi; data di avvio; referenti dallo specchio del Portale Service e dai Dati aziendali,
  per la linea PP la casella network@). Al collegamento della sede il perimetro si riallinea (royalties della sede nuova).
- b) solo corner: "Contratto punto prelievi firmato: <punto>" a `hub_pp_dest_conferma` con il riepilogo, il link alla scheda e il PDF firmato.
- c) "Avvio del nuovo punto prelievi <punto>" a `hub_pp_dest_avvio` con la data di avvio effettiva, indirizzo, partner, orari e stato
  dell'autorizzazione. **Scelta**: parte alla firma se la data effettiva c'è, altrimenti resta "in attesa della data" e parte al
  salvataggio della data nella scheda (o dal job).
- d) **primo ordine standard** in Ordini: ordine in BOZZA (origine SISTEMA, riferimento `BH-PP-<account>`, idempotente) per la sede del
  punto con quantità 1 di ogni articolo attivo del Magazzino Centrale con la visibilità Punti Prelievo (`visible_sedi`, non "solo
  laboratorio"; se nessun articolo è del Magazzino Centrale valgono quelli presenti, come in "Nuovo ordine"), nota "Primo ordine standard del
  punto prelievi <punto>" e nota per l'Area Operations, evento nell'ordine, attività AVVIO PRIMO_ORDINE nel diario. Senza sede collegata
  resta "in attesa della sede" e parte quando la sede viene creata e collegata; con Ordini non avviato (LIVE) o senza articoli PP il passo
  non riesce e si riprova.
- e) "Dotazione del nuovo punto prelievi <punto>: <elenco>" a `hub_pp_dest_dotazione` (elenco in Impostazioni).
- f) "Fondo cassa e POS per il nuovo punto prelievi <punto>" a `hub_pp_dest_amministrazione`: fondo cassa della sede in Cash Management
  (`cash.site_ext.cash_float`); se la sede non è configurata in Cash il **fondo cassa predefinito** delle Impostazioni di Cash
  (`default_cash_float`, nuovo), dichiarato come predefinito; senza nessuno dei due "da definire"; richiesta di ordinare il POS.
- g) "Adempimenti rifiuti speciali per il nuovo punto prelievi <punto>" a `hub_pp_dest_rifiuti`.

**5. Flagship.** Niente contratto al partner: il contratto è la locazione della sede (Sedi TD in locazione, Finance Management). **Regola scelta (la più
semplice): pulsante esplicito** "Avvia il punto prelievi" nella scheda, con la data di avvio effettiva obbligatoria: esegue c-g, porta la
pipeline alla fase 6 (sede pronta) e si fa una volta sola (poi "Riprova"); quando il fascicolo di autorizzazione della sede è AUTORIZZATO e
il flagship non è avviato, il cruscotto lo mostra tra i "Flagship autorizzati da avviare" (promemoria, nessun avvio automatico). La fase 7
(Attivo) resta al CEO per tutti i punti.

**Cruscotto** (filtro PP o tutte le linee): "Punti prelievo: passi dell'avvio da completare" (non riusciti con "Riprova" e in attesa) e
"Flagship autorizzati da avviare". **Job** `business:avvio-pp` ogni 30 minuti: riprende i passi in attesa quando sede o data ci sono (mai i
non riusciti). Un avvio alla volta per account (coda in memoria: la Suite gira in una sola istanza).

**API** (`/api/business/hub`): `GET|PUT /accounts/:id/punto`, `POST /accounts/:id/contratto-partner/prepara` (l'invio è `POST /kit/:id/invia`),
`POST /accounts/:id/contratto-firmato` (multipart `file`), `POST /accounts/:id/avvio` ({ data }, flagship), `POST /accounts/:id/avvio/riprova`
({ passi? }), `GET /punti-prelievo`, `POST /punti-prelievo/da-sede` ({ site_id }); `POST /accounts` accetta per la linea PP `pp_site_id`,
`pp_nome`, `pp_tipo_previsto`. Pubbliche: `GET|POST /api/business/b2b/:token` (variante PARTNER). Diario: tipo AVVIO (passi), sottotipi
EMAIL CONTRATTO_PARTNER, BENVENUTO_PARTNER, CONFERMA_PP, AVVIO_PP, DOTAZIONE_PP, FONDO_CASSA_PP, RIFIUTI_PP, INVITO_SUITE.

**Privacy**: nei log del server solo id, passi ed esiti; nel registro email l'oggetto è "Business Hub · account N" e nessun corpo; la
password provvisoria non si conserva (con la posta in modalità registro non arriva a nessuno: in collaudo la si reimposta a mano).

**Collaudo del 06/11/2026** (db `suite_pp_t`, porta 3144, posta in modalità registro; moduli business, cash, orders avviati; 14 articoli di
prova in Ordini, 12 con la visibilità Punti Prelievo e 1 solo laboratorio). Corner (Farmacia Corner Prova, sede OSPITATA, fondo cassa 200 €
in Cash): account dalla sede (corner dalla sede), contratto PP-2026-0001 generato, inviato da network@ (REGISTRATO, a referente, cc Francesco
Epifani e Silvia Sansoni, fase 4; secondo invio 409); risposta per email da un mittente sconosciuto con il riferimento: abbinata, PDF da
verificare; form del partner (variante PARTNER, MOD173 404) con il contratto firmato: contratto FIRMATO con il PDF, PDF nel fascicolo
(disponibilità dei locali), fase 6; con Ordini fermo: a) b) e) f) g) fatti, c) in attesa della data, d) non riuscito; data impostata → c)
inviato; Ordini avviato e "Riprova" → ORD in BOZZA con 12 righe a quantità 1; seconda Riprova 400; conferma del PDF arrivato per email:
"già ricevuto", nessuna email nuova. Accesso esterno del partner: Home con Cash (più Portale Service e SGI aperti a tutti, Circolari, Ticket,
Rubrica), `/api/cash/canoni/partner` 200 con la sola sede ospitata, rendiconti e versamenti di Cash 403, Business Hub e Ordini 403. Flagship
(sede in LOCAZIONE, non configurata in Cash): fascicolo AUTORIZZATO → promemoria nel cruscotto; "Avvia" senza data 400; con la data c-g
fatti, fondo cassa "150,00 € (fondo cassa predefinito delle Impostazioni di Cash ...)", fase 6, secondo avvio 409. Corner previsto senza sede
con contratto caricato a mano (nessun contratto PP nel modulo: avviso): d) in attesa della sede; sede creata e collegata con la data →
c) e d) eseguiti, perimetro Cash del partner riallineato sulla sede nuova. Schermate `docs/screens/hub-pp-account.png`,
`hub-pp-avvio.png`, `hub-pp-elenco.png`, `hub-pp-form-partner.png`.

**Da verificare in produzione**: permessi Graph Mail.Read e Mail.Send sulla casella network@ (Impostazioni, "Prova la casella" e "Prova
l'invio" della linea Punti Prelievo); che gli indirizzi interni esistano (laboratorio@, valentina.zezza@, amministrazione@,
iacopo.cupelli@, silvia.sansoni@); il fondo cassa predefinito in Cash > Impostazioni (vuoto: "da definire"); la visibilità Punti Prelievo
degli articoli del Magazzino Centrale (definisce il primo ordine); sedi PP esistenti senza account: "Crea il punto prelievi" dall'elenco.

## Contratto nella scheda del cliente, revisione del listino/offerta, offerta economica ripulita (07/11/2026)
Richiesta del CEO, testuale: "Elimina la % di sconto. Elimina la colonna di sconto se non c'è sconto. Elimina la riga preparata per.
Elimina la riga versione. Elimina la riga 'Ci prendiamo cura ...'. Elimina la riga 'Listino di riferimento ...'. La pagina del contratto
del cliente va assolutamente inglobata nella scheda del cliente. Così oggi è completamente scollegata dal resto. Per capirci, è quella la
parte essenziale. Il contratto è lì! E poi si ricongiunge nel file unico PDF che gli mandiamo. Ma quella parte viene anche prima del
listino/offerta! Inoltre nel listino/offerta devi prevedere una sezione di revisione listino/offerta in cui può cambiare anche solo un
prezzo e noi rigeneriamo a quel punto solo il PDF del listino/offerta e mandiamo rifirmato solo quello!" Migrazione `012_revisione_offerta.sql`.

**Scheda account.** Ordine delle schede: Diario, Referenti, **Contratto**, Listino e offerta, **Kit e contrattualizzazione** (ex "Proposta e
contratto": kit, form online, allegati da verificare, contrattualizzazione, avvio; il riepilogo "Cliente contrattualizzato/attivo" resta lì),
Criticità, Ordini, NC, Ticket, Circolari, Portale, Fascicoli, Documenti, Email, Pacchetto di benvenuto, Dati economici, Dati commerciali.
PP: Diario, Referenti, Contratto, Punto prelievi, Criticità, ...; MDL come il Service. La vecchia scheda "Contratti" non c'è più:
`?scheda=contratti` apre la scheda Contratto, `/business/account/:id/contratti/:cid` reindirizza a `?scheda=contratto&contratto=:cid`.

**Contratto nella scheda.** La pagina del contratto è il componente `components/ContrattoDettaglio.jsx` (`{ id, embedded, onChange }`),
usato dalla pagina `/business/contratti/:id` (Management > Tutti i contratti, elenchi, fascicoli) e incorporato nella scheda: stesso
contenuto e stesse azioni (Genera proposta / Rigenera, Modifica, Modifica (nuova revisione), Genera documento vN, Carica firmato, Cambia
stato, Segna come attivo, Annulla, Cessazione, Elimina bozza, Dati della proposta, Controparte MOD173, Listino dell'offerta, Credenziali
del portale, Altri documenti, Revisioni, Cronologia), senza il titolo della pagina, senza "Account nel Business Hub" e "Torna alla
scheda"; ogni azione ricarica anche l'account (fase, diario, documenti). Contratto mostrato: quello di `offertaDi(a)` (il più recente non
annullato né cessato della linea; PP: della sede del punto), restituito da `GET /hub/accounts/:id` come `contratto_corrente_id`; con più
contratti della linea un selettore in alto, e "Tutti i contratti di questa Legal entity" apre l'elenco compatto dentro la scheda (un
contratto di un'altra linea si apre nella sua pagina). Senza contratti: riquadro "Nessun contratto" con "Nuova proposta", che apre la
ContractForm con Legal entity e linea già scelte (`?da=account&account=<id>&org=<Legal entity>`, PP anche `&site=<sede del punto>`); al
salvataggio, e dopo "Modifica" aperta dalla scheda, si torna alla scheda Contratto con quel contratto.

**Contratto firmato: una sola strada.** Prima "Carica firmato" della pagina del contratto (`POST /contracts/:id/files`, categoria FIRMATO)
metteva il PDF e lo stato FIRMATO sul solo contratto, mentre la contrattualizzazione del processo (`lib/contrattualizza.js`: form online,
casella, "Carica il PDF firmato") faceva anche fase 6, attivazione e comunicazioni, e firmava il contratto di `offertaDi`. Ora, per Service
e Punti Prelievo con l'account nel Business Hub, "Carica firmato" (un solo PDF, mai in BOZZA) salva il PDF nei documenti dell'account
(CONTRATTO_FIRMATO, verificato) e chiama `contrattualizza(account, { contrattoId })`: contratto scelto FIRMATO con la data e il PDF tra i
suoi file (un solo file, evento FIRMATO), fase 6, attivazione e comunicazioni **una volta sola** (`contrattualizzato_at`); un secondo PDF
va nel contratto e nel diario senza ripetere nulla. La risposta porta `contrattualizzazione` (già fatta o eseguita, fase, avvisi).
`firmaContratto` accetta il contratto esplicito (stessa Legal entity e linea), altrimenti usa `offertaDi`. Medicina del Lavoro (nessun
processo di contrattualizzazione) e sedi in locazione restano sul solo contratto, come prima.

**Listino: revisione** (scheda Listino e offerta, riquadro "Revisione del listino/offerta"; parte operativa `lib/revisioneOfferta.js`,
regola pura `applicaRevisione` in `lib/listino.js`). "Rivedi i prezzi" dalla versione corrente: tabella modificabile in pagina (Offerta €
riga per riga, con la spunta anche Listino €; ricerca per codice, esame o settore; "solo le righe cambiate"; righe cambiate in giallo con il
prezzo precedente barrato; righe cambiate, totale listino, totale offerta e sconto medio in tempo reale), "Motivo della revisione"
obbligatorio, "Salva come versione N+1": stesse righe con i prezzi modificati e lo sconto ricalcolato, mapping e intestazioni ereditati,
`differenze` con la funzione di sempre, note = motivo, `origine` REVISIONE (EXCEL per i caricamenti), `base_listino_id`; la nuova versione
è la corrente e lo sconto medio dell'account la segue; diario LISTINO sottotipo REVISIONE con le righe cambiate (prima → dopo). La
versione precedente resta nello storico. Poi tre passi nel riquadro: 1) "Genera l'offerta economica" della nuova versione (solo quel PDF:
non il pacchetto, non la lettera MOD230; il motivo non si precompila nelle note del PDF), 2) "Invia per la firma": "Scrivi al cliente" con
l'offerta PDF già allegata, destinatari dai referenti, oggetto e testo dal modello "Revisione dell'offerta economica" delle Impostazioni
(`{{cliente}}`, `{{versione}}`, `{{righe_cambiate}}`, `{{data}}`), riepilogo e copie fisse come sempre; registrato come EMAIL_OUT
sottotipo OFFERTA_REVISIONE (`listini.revisione_inviata_at`), 3) offerta firmata: "Carica l'offerta firmata (PDF)" oppure, se arriva come
risposta, il PDF diventa "da verificare" (l'account ha un'offerta inviata e non firmata) e nella scheda Kit e contrattualizzazione si
conferma con "È l'offerta economica firmata" (versione: l'ultima inviata e non firmata, altrimenti la corrente). Documento con l'etichetta
"Offerta economica vN firmata", `firmata_at` sulla versione, che resta (o torna) la corrente; attività OFFERTA_ECONOMICA sottotipo
OFFERTA_FIRMATA; **nessuna contrattualizzazione nuova** e nessuna comunicazione. Validazione: chiave di riga esistente e non ripetuta,
prezzi numerici ≥ 0 (anche con la virgola), almeno un prezzo diverso, motivo di almeno 5 caratteri, solo dalla versione corrente, solo chi
gestisce la linea. Il pacchetto e il kit usano l'offerta della versione corrente, quindi quella rivista.

**Offerta economica: contenuto** (`lib/offertaEconomica.js`). Copertina: titolo, cliente e indirizzo, poi Data, Valida fino al, A cura di,
Alla cortese attenzione (senza "preparata per", senza la riga della versione, senza la fascia "Ci prendiamo cura del tempo dei pazienti,
lì dove ogni minuto conta."). Corpo: due riquadri (esami in offerta, valida fino al: niente sconto medio), condizioni di pagamento e prezzi
(niente "Listino di riferimento"), tabelle per settore con Codice, Esame, Listino €, Offerta € e **Sconto solo se almeno un esame ha un
prezzo offerto sotto il listino** (altrimenti la colonna sparisce e l'esame si allarga), note, chiusura e firma. La versione resta nel nome
del file (`AAAA-MM-GG_Offerta_economica_<cliente>_vN.pdf`), nel titolo dei metadati del PDF, nel registro dei listini e nel diario. Il
pacchetto unico continua a includere la lettera di offerta (MOD230 del contratto) e l'offerta economica: lì nulla cambia (la fascia "Ci
prendiamo cura" della copertina del pacchetto di benvenuto non è dell'offerta e resta).

**API** (`/api/business`): `POST /hub/accounts/:id/listini/:lid/revisione` ({ righe: [{ chiave, offerto, listino? }], motivo }),
`GET /hub/listini/:id/revisione/email`, `POST /hub/listini/:id/offerta-firmata` (multipart `file`), `GET /hub/listini/:id` (righe con la
`chiave`), `POST /hub/accounts/:id/email/invia` accetta `sottotipo: 'OFFERTA_REVISIONE'` e `listino_id`, `POST /hub/documenti/:id/verifica`
accetta `esito: 'OFFERTA_FIRMATA'`, `GET /hub/accounts/:id` restituisce `contratto_corrente_id`; `POST /contracts/:id/files` con FIRMATO
passa dalla contrattualizzazione (Service e PP con account).

**Test**: `server/test/business-revisione-offerta.test.mjs` (contenuto di copertina e corpo, colonna dello sconto, revisione pura con
validazione, modello; con `DATABASE_URL_TEST` il flusso: contratto firmato dalla scheda una volta sola, revisione v2, offerta v2, invio
OFFERTA_REVISIONE, offerta firmata senza nuova contrattualizzazione).

**Collaudo del 07/11/2026** (db di prova `suite_ctr_t`, porta 3145, posta in modalità registro; DB Opportunità importato: 424 account).
Centro Medico Sirio (SRV, fase 5, dati della Legal entity di prova completati): scheda Contratto con "Nessun contratto"; contratto SRV
creato (`contratto_corrente_id` = quello), proposta SRV-2026-0001 generata dalla scheda; "Carica firmato" dalla scheda → contratto
Firmato, fase 6, comunicazioni interna, benvenuto e laboratorio REGISTRATE, attivazione; secondo PDF: "già contrattualizzato", nessuna
email nuova, una sola attività di fase 6. Vecchio indirizzo `/account/42/contratti/1` → scheda Contratto. Listino di 3 esami, offerta v1
di 2 pagine senza le righe eliminate; revisione in pagina dell'emocromo 5,20 → 5,00 € con motivo → v2 (1 riga cambiata, sconto medio
38,4% → 39,2%); offerta v2 (2 pagine); "Invia per la firma" con il PDF allegato (REGISTRATO, OFFERTA_REVISIONE); offerta firmata caricata →
"Offerta economica v2 firmata", v2 corrente, nessuna contrattualizzazione. Seconda revisione v3 inviata, risposta simulata con il PDF:
abbinata, da verificare, "È l'offerta economica firmata" → v3 firmata. Pacchetto unico: 34 pagine con lettera di offerta (pagina 5) e
offerta economica (pagina 25). Schermate `docs/screens/hub-contratto-in-scheda.png`, `hub-listino-revisione.png`.

**Da verificare in produzione**: che l'ordine delle schede e il contratto incorporato vadano bene al CEO sugli account con molti contratti
(pacchetti del 21/07/2026); testo del modello "Revisione dell'offerta economica" (Impostazioni, scheda dei modelli); che la casella service@
riceva le risposte con l'offerta firmata (stessi permessi Graph del kit).

## Contratto Service MOD230: campi, allegati rinumerati, firma di TD, Politica della Qualità (07/11/2026)

Richiesta del CEO: "tendina per le modalità di pagamento. in modifica cancello le note, per esempio, salvo ma lui le rimette e quindi non
salva correttamente! errore grafico nel pulsante 'responsabile ...'. in nominativo del committente di default ripeti la legal entity.
fammi caricare la firma del firmatario del contratto (PNG, JPG) in modo tale che venga perfettamente apposta nel pdf. una riga di spazio
in più nel contratto tra i commi dell'art. 4 e il 5. idem tra 14 e 15. riorganizziamo gli allegati: accorpa 1 e 2, sono la stessa cosa.
dal widget SGI prendi la versione della politica della qualità più aggiornata e allegala come ultimo allegato al contratto! precompila i
dati dell'allegato 3 se non è indicata una sede operativa diversa da quella legale." Regole pure in `lib/mod230.js`, PDF in
`lib/contrattoPdf.js`, firma in `lib/firmaTd.js`, Politica in `lib/politicaQualita.js`; migrazione `013_firma_td.sql`.

**Campi del form** (Contratti > Service, "Modifica proposta").
- *Termini di pagamento*: tendina con "Predefinito: <testo delle Impostazioni>" (campo vuoto), "Bonifico bancario 30 gg f.m. data
  fattura", "Bonifico bancario 60 gg f.m. data fattura", "Bonifico bancario a vista fattura", "RID/SDD 30 gg f.m.", "Altro (specificare)"
  che apre il campo libero; un valore già salvato fuori elenco resta selezionabile come "<valore> (valore attuale)". Elenco in
  `format.js` (`TERMINI_PAGAMENTO`, `opzioniPagamento`), stessa tendina nella lettera MdL.
- *Campi svuotati*: la causa era il PUT `/contracts/:id` (`notes = d.notes ?? c.notes`: lo schema trasforma '' in null e il `??` rimetteva
  la nota precedente, anche quella importata dalla Pipeline B2B; idem per decorrenza e scadenza, e `title = coalesce(...)`). Ora un campo
  presente nella richiesta si salva com'è (vuoto = null); si conserva solo quello che la richiesta non contiene; la denominazione breve
  vuota torna quella predefinita (ragione sociale, "Punto Prelievi <comune>", tipo di sede e comune). I campi di `data` erano già corretti.
- *Ruolo privacy*: il segmented control "Titolare del trattamento / Responsabile per conto di un Committente" era stirato a tutta la
  colonna (riquadro vuoto a destra) e, con le voci su una riga sola, il testo veniva tagliato nelle colonne strette. `business.css`: il
  controllo è largo quanto le voci (`label.f > .seg { align-self: flex-start }`) e una voce lunga va a capo nel suo bottone (vale per
  tutti i segmented control del modulo). Schermata `docs/screens/hub-contratto-form.png` (1366 px; verificato anche a 1920 e 900 px).
- *Nominativo del Committente*: scegliendo "Responsabile" con il campo vuoto si precompila con la ragione sociale della Legal entity
  controparte (modificabile); vuoto anche nel documento vale la ragione sociale (`committente()`).
- *Logistica dei ritiri (Allegato 2)*: i campi vuoti mostrano in grigio i valori che andranno nel documento: sede operativa del contratto
  se indicata (denominazione e indirizzo della sede operativa, città dall'ultima parte dell'indirizzo dopo la virgola), altrimenti sede
  legale della Legal entity; referente, telefono ed e-mail dal referente principale dell'account (`contatti.principale`, restituito da
  `GET /contracts/:id` come `referente_principale`). "Precompila i campi vuoti" li scrive nel form. La generazione applica la stessa regola
  (`ritiroPredefinito` in `mod230.js` e `format.js`, verificate uguali dai test) ai soli campi vuoti.
- *Apponi la firma di TD nel PDF* (scheda Proposta, Service e MdL): `data.firma_td` (null = sì se la firma è caricata, false = mai);
  disattivata se in Impostazioni non c'è la firma.

**Allegati** (template `templates/offerta_service.docx`, riscritto una volta con `rinumeraRichiami` di `mod230.js`; la versione
precedente è quella della v0.51.0). L'1 "Elenco analisi effettuate da Toscana Diagnostica" e il 2 "Prezzi e Condizioni Economiche" sono diventati
**1 "Elenco delle analisi, prezzi e condizioni economiche"**: testo del catalogo, frase del listino con i nomi dei file caricati e il
rimando all'Offerta economica impaginata, le cui pagine entrano nel PDF (dalla seconda richiesta del 07/11/2026 la tabella dei prezzi nel
DOCX non c'è più: vedi "Allegato 1 = Offerta economica" più sotto). Poi 2 Ritiro campioni, 3 Trasporto materiali infettivi (la circolare del kit si chiama "Allegato 3 - Circolare
Ministero 8 Maggio 2003.pdf"), 4 Guida agli Esami, 5 Interfacciamento informatico, 6 Terzi Incaricati, 7 Ruolo privacy del Cliente,
8 Politica della Qualità. Rinumerati la Lista degli allegati, i titoli "ALLEGATO n —", i richiami del corpo (Allegato n. 2 → 1 nello
sconto e nel tariffario dell'art. 5.1, n. 3 → 2 ritiri, n. 4 → 3 trasporto, n. 5 → 4 Guida, n. 6 → 5 interfacciamento, n. 7 / Allegato 7
→ 6 Terzi, n. 8 → 7 privacy, "con relativi 9 Allegati" → 8) e le etichette del form (Allegato 5 interfacciamento, Allegato 1 listino,
Allegato 2 ritiri, Allegato 7 privacy). La lettera MdL (MOD231) ha la sua numerazione e non cambia.

**Spaziature**: una riga vuota in più prima del titolo "5. Prezzi, modalità di pagamento e morosità del Cliente" e di "15. Foro" (paragrafi
vuoti nello stile del documento) e il titolo resta con il primo comma (keepNext: non più da solo in fondo alla pagina).

**Firma di TD nel PDF**. Blocchi firme di MOD230 e MOD231 (tre per lettera: offerta, approvazione ex artt. 1341-1342, "Letto, approvato
e sottoscritto"): tra la riga "qualifica" e la riga "nome" c'è una riga vuota alta 1,5 cm (spazio della firma di TD; nella colonna del
Cliente è lo spazio sopra la linea) e i segnaposto `{firma_ruolo}`/`{firma_nome}` (Impostazioni, "Firmatario dei contratti"). Alla
generazione il PDF di LibreOffice si legge con pdf-parse (testo con le coordinate), si trova nella metà destra della pagina il nome del
firmatario con la qualifica sopra e si disegna l'immagine con pdf-lib nel rettangolo tra le due righe: altezza al massimo quella dello
spazio, larghezza al massimo 170 pt, proporzioni conservate, centrata sul nome, PNG con la sua trasparenza. Scelta: ancorare la firma al
testo stampato e non a coordinate fisse (il blocco firme cambia pagina con i dati) né a un segnaposto nascosto (resterebbe nel testo
selezionabile del PDF). Se nome e qualifica non si trovano il PDF esce senza firma con un avviso. Il DOCX resta con lo spazio vuoto.
L'evento GENERATO registra `firmato_td`, `firma` (nome, qualifica, blocchi firmati, sha256 dell'immagine) e la nota "PDF firmato da
Toscana Diagnostica (nome, qualifica)"; la risposta della generazione ha `firmato_td` e `avvisi`.

**Politica della Qualità (Allegato 8)**. Dallo specchio del Portale SGI (modulo sgi, `docs.json` e cache dei file): prima un documento
intitolato "Politica della/per la Qualità", poi la Politica Integrata della famiglia POL (nel SGI di TD la politica per la qualità è la
Politica integrata multi-norma TD-SGI-POL001, come dice il testo dell'allegato), con PDF, revisione più alta. Nel DOCX l'allegato ha il
riferimento "Documento di riferimento: TD-SGI-POL001 "Politica Integrata", revisione 02 del 29/10/2026 (...). Il testo integrale è
riportato in coda alla versione PDF"; nel PDF le pagine del documento SGI si accodano dopo l'ultima pagina del contratto. Se il modulo SGI
non è avviato, lo specchio è vuoto o il PDF non si legge: allegato con "Documento non disponibile dallo specchio SGI al momento della
generazione: ne viene fornita copia al Cliente al momento della sottoscrizione", avviso nell'evento GENERATO e riquadro "Documento
generato con avvisi" nella scheda del contratto.

**API** (`/api/business`): `PUT /contracts/:id` (campi inviati vuoti = vuoti), `GET /contracts/:id` con `referente_principale`,
`POST /contracts/:id/generate` con `avvisi` e `firmato_td`, `GET|POST|DELETE /settings/firma`, `GET /settings/firma/immagine`.

**Test**: `server/test/business-mod230.test.mjs` (tendina con il valore attuale, rinumerazione pura e template con allegati, richiami,
lista, righe vuote e blocchi firme, ritiro precompilato e parità form/documento, committente, ricerca della Politica anche sul `docs.json`
del portale SGI, dati del documento (Allegato 1: vedi la sezione più sotto), spazio della firma e firma di prova apposta su un PDF; con
`DATABASE_URL_TEST`: note svuotate, denominazione predefinita, campi non inviati intatti, caricamento della firma solo PNG/JPG fino a 1 MB).

**Collaudo del 07/11/2026** (db di prova `suite_m230_t`, porta 3146, specchio SGI da un server statico del repo del portale SGI sulla
porta 7053). Legal entity e account Service fittizi con referente principale e listino di 3 esami; contratto SRV con Responsabile
(committente = ragione sociale), pagamento "Bonifico bancario 60 gg f.m. data fattura", nota della Pipeline B2B svuotata da form: resta
vuota (anche riaprendo il form); "Altro" con testo libero salvato e riproposto come "(valore attuale)". Firma di prova (PNG generato con la
scritta "firma di prova") caricata in Impostazioni (`docs/screens/hub-impostazioni-firma.png`). PDF di 28 pagine: firma nei tre blocchi
(pagine 2 e 10), art. 5 in testa a pagina 5 con tre righe vuote prima, art. 15 con cinque righe vuote prima, Lista degli allegati 1-8,
Allegato 1 con la tabella dei prezzi, Allegato 2 con sede legale e referente principale, Allegato 8 con il riferimento a TD-SGI-POL001
rev. 02 e le 9 pagine della Politica Integrata in coda. Ripiego provato togliendo `docs.json` dallo specchio: PDF di 19 pagine, allegato
"Documento non disponibile dallo specchio SGI", avviso nell'evento. Esempio: `2026-11-07_Contratto_Service_esempio.pdf`.

**Da verificare con il CEO**: le spaziature degli artt. 5 e 15 (nel PDF prima della modifica c'erano già 2 e 4 righe vuote; il titolo
dell'art. 5 restava da solo in fondo a pagina 4, probabilmente l'effetto visto: ora va in testa alla pagina successiva con il primo comma);
che la Politica Integrata TD-SGI-POL001 sia il documento giusto (nel SGI non c'è un documento intitolato "Politica della Qualità"); la firma
vera (PNG con sfondo trasparente, ritagliata stretta attorno al tratto, per occupare bene lo spazio); il contratto Punti Prelievo ha un
altro blocco firme ("L'Amministratore Delegato" in persona del legale rappresentante) e per ora non riceve la firma.

## Allegato 1 = Offerta economica, pacchetto e kit senza doppione (07/11/2026)
Richiesta del CEO guardando il pacchetto di un cliente (lettera di offerta MOD230 di 76 pagine perché l'Allegato 1 conteneva la tabella di
2793 esami, poi l'Offerta economica impaginata di 84 pagine): "credo che l'allegato 1 e la lettera di offerta siano un doppione! e mi piace
più la lettera di offerta dell'allegato 1. quindi sostituisci l'allegato 1 con la lettera di offerta." Interpretazione: l'Allegato 1 del
contratto è il documento "Offerta economica" (`lib/offertaEconomica.js`) inserito nel PDF al posto della tabella DOCX, e nessun invio
contiene due volte gli stessi prezzi. Migrazione `015_allegato1_offerta.sql` (`contract_files.meta`).

**Template** (`templates/offerta_service.docx`, riscritto una volta con uno script fuori dal repo: tolti `{#ha_listino}`,
`{listino_intro}`, le due tabelle `{#con_listino}`/`{#solo_offerta}` con `{#listino_righe}`). Al loro posto il paragrafo
`{allegato1_offerta}` (`testoAllegato1` in `lib/mod230.js`): con l'offerta "I prezzi riservati al Cliente sono riportati nell'Offerta
economica che segue, parte integrante del presente Allegato (listino StudioLAB versione N del gg/mm/aaaa, M esami)." (data = caricamento
della versione, esami dal riepilogo); senza listino, o se l'offerta non si può produrre, "L'Offerta economica con i prezzi riservati al
Cliente verrà allegata alla sottoscrizione." Il testo del catalogo (settori, formato Excel e PDF) e la frase del listino restano.

**Generazione** (`POST /contracts/:id/generate`, Service con account). Versione corrente del listino dell'account → `offertaAllegato1`
(`routes/contracts.js`): se l'offerta di quella versione esiste e si legge si usa; altrimenti si genera adesso con `creaOfferta`
(`routes/listino.js`), registrata come dalla scheda Listino e offerta (documento OFFERTA_ECONOMICA dell'account, attività nel diario,
LISTINO_PDF del contratto con evento ALLEGATO), condizioni di pagamento del contratto (poi della Legal entity, poi il predefinito),
validità e destinatario come i predefiniti della scheda. PDF: LibreOffice, firma di TD nei blocchi firme, **poi** l'inserimento
(`inserisciOffertaAllegato1` in `lib/contrattoPdf.js`: così il blocco "Per Toscana Diagnostica" dell'offerta non riceve la firma del
contratto), poi la Politica della Qualità in coda. La posizione si legge dal testo del PDF (`posizioneOffertaAllegato1`, pura): pagina del
titolo "ALLEGATO 1 — Elenco", poi la prima pagina successiva con il titolo "ALLEGATO 2 —"; le pagine dell'offerta (copertina compresa,
con la sua numerazione) entrano prima di quella. Titoli non trovati (o nella stessa pagina) = nessun inserimento e avviso. Segnalibri: il
PDF di LibreOffice del contratto oggi non ne ha; se li avesse, se ne aggiunge uno "Allegato 1 · Offerta economica vN" nell'ordine delle
pagine (`aggiungiSegnalibroSePresenti`). Il GENERATO_PDF registra `meta.allegato1_offerta = { listino_id, versione, documento_id,
pagine, pagina }` (pagina = prima pagina dell'offerta nel PDF del contratto); l'evento GENERATO ha la nota "Allegato 1: offerta economica
vN (K pagine)" (e "Offerta economica vN generata per l'Allegato 1 (file)" se generata ora) e `allegato1` nei dati; la risposta ha
`allegato1`. Senza LibreOffice o con l'offerta non generabile: testo "verrà allegata" e avviso. Il DOCX generato non contiene l'offerta
(che è un PDF): è la versione modificabile. I numeri di pagina del contratto restano quelli di LibreOffice (le pagine dell'offerta hanno
i loro: l'Allegato 2 continua dal numero dell'Allegato 1).

**Pacchetto** (`lib/pacchettoGenera.js`, regola pura `letteraConOfferta` in `lib/pacchetto.js`). Se la lettera di offerta inclusa (02,
GENERATO_PDF) ha `meta.allegato1_offerta.listino_id` uguale alla versione corrente del listino, la sezione "Offerta economica" (03) non si
aggiunge (`nellaLettera`, motivo "Già nella lettera di offerta (Allegato 1 del contratto)", in grigio nella composizione e non tra le
"Non incluse" dell'indice); la voce dell'indice della lettera dice "con l'offerta economica vN nell'Allegato 1 (da pagina P)" e i
segnalibri hanno "Offerta economica (Allegato 1, vN)" subito dopo "Lettera di offerta" (`segnalibriInterni` di `assembla`). Lettera
esclusa dall'operatore o non leggibile: l'offerta economica torna sezione a sé. Lettera generata prima (senza `meta`) o con un'altra
versione del listino: sezione 03 come prima. `GET .../pacchetto` espone `disponibilita.listino_nella_lettera`.

**Kit di proposta** (`lib/flusso.js`): stessa regola (`stato.lettera.con_offerta`): se la lettera MOD230 contiene già l'offerta della
versione corrente, il PDF dell'offerta economica non si allega (un file in meno) e la lettera ha il ruolo "Lettera di offerta (con
l'offerta economica del listino vN nell'Allegato 1)". La contrattualizzazione (email al laboratorio con la sola offerta) non cambia.

**Correzione collegata**: `posizioniTesto` (pdf-parse) riceve una copia del buffer con un ArrayBuffer tutto suo: un Buffer piccolo di
Node sta nel pool condiviso (byteOffset diverso da 0) e il pdf.js di pdf-parse leggeva byte sbagliati ("bad XRef entry"); con i PDF di
LibreOffice (grandi) non capitava, nei test con PDF piccoli sì a seconda dell'ordine delle allocazioni.

**Test**: `business-mod230.test.mjs` (template senza tabelle e con `{allegato1_offerta}` in fondo all'allegato, testo con e senza
listino, posizione dal testo delle pagine anche con titoli spezzati e richiami del corpo, inserimento in un PDF con e senza segnalibri,
documento con il rimando o "verrà allegata"); `business-pacchetto.test.mjs` (`letteraConOfferta`, composizione con lettera inclusa,
esclusa, vecchia, offerta ECONOMICA, senza listino; segnalibro interno di `assembla`).

**Collaudo del 07/11/2026** (db `suite_a1_t`, porta 3148, import del DB Opportunità, specchio SGI da un server statico del repo del
portale SGI, firma di prova). Account con il listino di prova (3 esami) senza offerta: contratto SRV generato in 5 s, offerta v1
generata al momento (documento dell'account e LISTINO_PDF del contratto), PDF di 30 pagine: Allegato 1 a pagina 12 con il paragrafo
"... (listino StudioLAB versione 1 del 07/11/2026, 3 esami).", pagine 13-14 l'offerta (copertina e tabelle, senza firma del contratto),
pagina 15 Allegato 2, Politica in coda; rigenerazione: offerta riusata. Pacchetto: 42 pagine, nessuna sezione 03, indice con la nota
"con l'offerta economica v1 nell'Allegato 1 (da pagina 17)", segnalibro a pagina 17. Kit: 4 allegati (pacchetto, lettera con l'offerta,
circolare, MOD173), senza il PDF dell'offerta. Account senza listino: Allegato 1 "verrà allegata", pacchetto senza 03 (nessuna offerta).
`meta` tolto a mano (contratto "vecchio"): pacchetto con 03 e kit con l'offerta allegata. Nuova versione v2 dopo il contratto: pacchetto
con 03 (v2); contratto rigenerato con la v2, lettera esclusa dall'operatore: 03 torna. Esempio:
`2026-11-07_Contratto_Service_allegato1.pdf`.

**Da verificare con il CEO**: la frase di chiusura dell'offerta ("Le condizioni contrattuali sono quelle della lettera di offerta e delle
Condizioni Generali di Contratto che vi trasmettiamo per la firma") resta anche dentro il contratto; con un listino grande il PDF del
contratto contiene tutte le pagine dell'offerta (nel caso segnalato 84, al posto delle pagine della tabella).

## Pacchetto ripulito, listino unico tra contratto e account, accessi al portale per tutti i referenti (07/11/2026)
Richieste del CEO: le correzioni dell'offerta economica "ANCHE qui" nel pacchetto di benvenuto; "che sia alla scheda del contratto o qui
l'upload del file XLSX deve essere lo stesso file. questa scheda [Listino StudioLAB del cliente] è perfetta e va tenuta"; "crea gli
accessi al portale per tutti i referenti inclusi in anagrafica". Migrazione `014_listino_unico.sql`.

**Pacchetto di benvenuto** (`lib/pacchettoDocx.js`, `lib/pacchetto.js`, `lib/pacchettoGenera.js`). Copertina senza la riga "preparato per"
e senza la fascia "Ci prendiamo cura del tempo dei pazienti, ..." (la carta intestata resta com'è: il suo piè non ha il motto); nelle
lettere predefinite "preparate per {{cliente}}" diventa "dedicate a {{cliente}}" (i modelli già personalizzati in Impostazioni non
cambiano). Lettera: ogni paragrafo e ogni riga andata a capo nel modello è un `<w:p>` a sé (un `<w:br/>` in un paragrafo giustificato
allargava le parole a tutta riga: "Gentile          Francesco          Sderci,"); il saluto iniziale e la chiusura sono allineati a
sinistra (`rigaASinistra`), il resto giustificato con l'ultima riga a sinistra; `testo()` fa lo stesso per gli altri paragrafi.
Tabella dei referenti (`bloccoReferenti`, la stessa nella lettera, nella pagina "Il vostro referente dedicato" e in "Serve aiuto?" della
checklist): tre colonne a larghezza fissa allineate in alto (ruolo in grassetto con la descrizione sotto; nome ed email; telefoni, fisso e
cellulare su righe separate), filetti leggeri, intestazione ripetuta. Righe (`righeReferenti`): **il CEO sempre in prima riga** (nome e
ruolo dal legale rappresentante delle Impostazioni, email `lr_email`, telefono dall'anagrafica: `people.phone_office` e `users.phone`
della persona con quell'email, in mancanza `lr_phone`; il cellulare personale `people.phone` non si pubblica; se non c'è la cella resta
vuota), poi i referenti della linea dallo specchio del Portale Service e dai Dati aziendali, poi l'owner dell'account se non è già tra
loro ("Il vostro referente dedicato", con la sua mansione). La pagina del referente esclude l'owner (ha la sua scheda sopra); la checklist
mostra CEO, owner e supporto clienti. Pagina delle credenziali: tutti gli accessi esterni della Legal entity (già così).

**Listino unico** (`lib/listinoUnico.js`). Sorgente unica: le versioni del listino dell'account (`listini`). `contract_files.listino_id`
dice da quale versione viene un file del contratto; senza `listino_id` il file è storico. Per il contratto Service con account
(`conListinoAccount`): ogni nuova versione (Excel dalla scheda Listino e offerta, dal riquadro del contratto, importato dal contratto,
revisione dei prezzi in pagina, con l'XLSX ricostruito dalle righe) si registra come LISTINO_XLSX del contratto della linea
(`collegaVersione`, idempotente) e toglie dal contratto la copia della versione precedente (che resta nei documenti e nello storico
dell'account); l'offerta economica PDF generata dalla versione corrente diventa il LISTINO_PDF (`collegaOfferta`); la generazione della
lettera MOD230 collega la versione dell'Allegato 1. Evento ALLEGATO nella cronologia del contratto. Il salvataggio è
`salvaVersione(a, input, userId)` di `routes/listino.js`, usato da `POST /hub/accounts/:id/listini`, da `.../listini/da-contratto/:fileId`
(il file storico si collega alla versione, senza copia), da `POST /contracts/:id/files` con LISTINO_XLSX (Service con account) e
dall'importazione automatica: `GET /hub/accounts/:id` di un account Service senza listino con un Excel storico nel contratto lo importa
(v1, attività LISTINO nel diario); se le colonne non si riconoscono resta "Importa dal contratto". Riquadro "Listino dell'offerta" del
contratto (`c.listino_account`, `riquadroListino`): versione corrente (vN, data, esami, link alla scheda Listino e offerta), "Carica la
vN+1" con la stessa modale di `Listino.jsx` (`Carica`, anteprima e mapping), i file collegati e gli eventuali file storici. Contratti
senza account (MDL, SEDE, PP senza punto): riquadro e caricamenti di prima.

**Accessi al portale per tutti i referenti.** Regola pura `pianoAccessi` (`lib/processo.js`): per ogni referente HA_ACCESSO, DA_CREARE o
SALTATO con il motivo (senza email, email non valida, stessa email di un altro referente, impostazione "solo il principale").
`creaAccessiReferenti` (`lib/flusso.js`) crea gli accessi mancanti con `creaAccesso` (invito a ciascuno con la password provvisoria dalla
casella della linea, senza copie; attività ACCESSO per ciascuno e un riepilogo riga per riga), idempotente. Scheda Portale dell'account:
i referenti senza accesso con "Crea accesso" e, in alto, "Crea gli accessi per tutti i referenti" (conferma, esito riga per riga);
`GET/POST /hub/accounts/:id/accessi` (audit `HUB_ACCESSI_REFERENTI`); dopo la contrattualizzazione i nuovi accessi ricevono il profilo
della linea (`profiloLineaSu`). Al kit di proposta e alla contrattualizzazione si creano per tutti i referenti con email secondo
l'impostazione `hub_accessi_portale` (Business Hub > Impostazioni, processo Service: TUTTI predefinito, o PRINCIPALE come prima); chi
riceve l'invito alla creazione non ne riceve un secondo all'attivazione. Test: `server/test/business-listino-unico.test.mjs` e i nuovi casi
di `business-pacchetto.test.mjs`. Screenshot: `docs/screens/hub-portale-accessi.png`, `docs/screens/hub-contratto-listino-unico.png`.

## Lettera di offerta sempre fresca nel pacchetto, margine inferiore del contratto, "Qualità e certificazioni" (07/11/2026)
Fatto osservato dal CEO (pacchetto AgapeLab v4): la sezione 02 "Lettera di offerta" era il GENERATO_PDF salvato nel contratto giorni
prima con il template vecchio (tabella dei prezzi dell'Allegato 1 sul piè di pagina, buco tra gli artt. 14 e 15, nessuna offerta
economica dentro): "gli stessi errori" anche con il codice corretto. In più la pagina delle certificazioni era incompleta rispetto al sito.

**Generazione condivisa** (`lib/contrattoGenera.js`). `rendiContratto` (DOCX dal template + PDF di LibreOffice con firma di TD, Allegato 1
= offerta economica della versione corrente del listino, generata al momento se manca, Politica della Qualità in coda),
`salvaGenerati` (con `sostituisci` aggiorna sul posto le righe GENERATO_DOCX/GENERATO_PDF della versione: stesso id, così kit e invii
che le richiamano restano validi), `notaGenerazione`, `offertaAllegato1` (spostata da `routes/contracts.js`). La usano la scheda
Contratto (`POST /contracts/:id/generate`) e il pacchetto.

**Regola della rigenerazione** (`regolaRigenerazione`, pura): BOZZA/PROPOSTA come prima (nuova versione, protocollo alla prima volta);
oltre la proposta **senza file FIRMATO** (anche ATTIVO/FIRMATO importato senza PDF firmato) rigenerazione libera della versione corrente,
stessa versione, stato invariato, file della versione sostituiti (evento GENERATO "Rigenerazione della versione N"); **con il FIRMATO**
serve la revisione ("Modifica (nuova revisione)", poi "Genera documento vN"), altrimenti "Il contratto firmato è caricato e il documento
della versione N esiste già: ...". Oltre la proposta genera l'Admin del modulo. Scheda Contratto: "Rigenera DOCX e PDF" (o "Genera
documento vN" se manca) per l'Admin quando non c'è il firmato.

**Pacchetto** (`letteraDiOfferta` in `lib/pacchettoGenera.js`): alla generazione (benvenuto e kit; non per i prospect né se l'operatore
esclude la lettera)
- contratto **senza FIRMATO** con protocollo: la lettera si renderizza dal contratto corrente con il codice attuale
  (`rigeneraDalPacchetto`: dati completi, stessa versione, nessuna revisione) e **sostituisce** GENERATO_PDF/GENERATO_DOCX della versione
  corrente, evento GENERATO "Documento della versione N rigenerato dal pacchetto di benvenuto con il template attuale" (dati
  `rigenerato_dal_pacchetto: true`), attività del pacchetto "Lettera di offerta rigenerata dal contratto corrente"; se la rigenerazione
  non si può fare (contratto mai generato, dati incompleti, LibreOffice assente) resta il PDF salvato con l'avviso;
- contratto **con il FIRMATO** (PDF): nel pacchetto va il firmato (titolo "Lettera di offerta firmata", nota "Contratto P, versione N,
  firmato il ..."); l'offerta economica corrente si aggiunge come sezione 03 se la versione del listino è cambiata dopo la firma
  (`listinoDopoLaFirma`: la lettera generata della versione del firmato non conteneva quella versione e il listino è stato caricato dopo
  il giorno della firma o, senza data della firma, dopo il caricamento del firmato); se per quella versione l'offerta non è ancora generata, si genera.
- La composizione (`disponibilita`, `offerta_fonte`: FIRMATO, RIGENERATA, SALVATA) lo dice senza rigenerare. Il kit di proposta rilegge
  la lettera dopo il pacchetto (file e meta aggiornati).

**Margine inferiore** (`testoSulPiede` in `lib/mod230.js`, `controllaPiede` in `lib/contrattoPdf.js`): dalle posizioni del testo
(pdf-parse) il piè della carta intestata è l'insieme delle righe della fascia bassa che si ripetono (quota e testo, cifre a parte) su
almeno il 60% delle pagine; ogni riga del corpo la cui base (meno il discendente) scende sotto la sommità del piè è una violazione (si vede
anche una tabella infilata tra le righe del piè). Il controllo gira a ogni generazione sul PDF del contratto prima dell'offerta e della
Politica (`esito.piede` nell'evento GENERATO; avviso "Testo sopra il piè di pagina in pagina ..." se serve). Le pagine dell'offerta
inserite nell'Allegato 1 tengono la numerazione dell'offerta (per ora va bene così). Sul pacchetto di produzione del 07/11 il controllo
trova la pagina 16 (tabella del vecchio Allegato 1); sul contratto generato oggi nessuna violazione.

**Qualità e certificazioni** (la sezione `diversi`, prima "Cosa ci rende diversi"; `qualitaCertificazioni` in `lib/pacchetto.js`, pagina
`diversi` in `lib/pacchettoDocx.js`): titolo "La qualità non è una promessa. È un metodo."; introduzione sul SGI; **tabella dei
certificati** (norma, sistema di gestione, numero, validità dal/al, ente in nota) dalla fonte di oggi, `certificazioni.json` dello
specchio del Portale Service (le ISO con numero: 9001:2015, 45001:2018, 14001:2015, 37001:2025 con i numeri TOSC5191...: norme e anni
come nella fonte, non corretti a mano); **standard di riferimento del SGI** nell'ordine del sito (Politica della Qualità nel SGI,
ISO 9001:2015, ISO 45001:2023, ISO 14001:2015, ISO 37001:2016, ISO 7101:2024, PAS 24000:2022, ISO 27001:2022, ISO 30415:2021,
UNI/PdR 125): quelli con il certificato prendono norma e numero del certificato, gli altri "Standard di riferimento" senza numeri; le
differenze di anno tra elenco e certificato (45001: sito 2023, certificato 2018; 37001: sito 2016, certificato 2025) vanno tra gli avvisi
del pacchetto ("nel pacchetto vale il certificato"); **accreditamento SSR** (L.R. Toscana 51/2009) e **Autorizzazione Sanitaria** dai
Dati aziendali (`health_authorization`); **pratiche** e **governance clinica** in due paragrafi; **Politica Integrata**: codice,
revisione e data dallo specchio SGI (`politicaQualita`, lo stesso documento dell'Allegato 8 del contratto) con il collegamento
`https://service.toscanadiagnostica.it/doc/TD-SGI-POL001` (il Portale Service pubblico apre sempre la revisione in vigore, come il
pulsante della pagina Certificazioni); in coda tre schede di "Cosa ci rende diversi". Impostazioni: Business Hub > Impostazioni,
"Pacchetto di benvenuto · Qualità e certificazioni" (`app_settings pacchetto.certificazioni`, `GET/PUT /hub/pacchetto/certificazioni`,
audit `HUB_PACCHETTO_CERTIFICAZIONI`): titolo, testi ed elenco degli standard modificabili (si salva solo ciò che differisce dai
predefiniti); i numeri dei certificati non si scrivono lì.

Test: `server/test/business-pacchetto-fresco.test.mjs` (regola della rigenerazione, listino dopo la firma, margine inferiore su un PDF di
esempio e sul contratto MOD230 vero convertito con LibreOffice, pagina e impostazioni delle certificazioni).


## Referenti dalle rubriche esterne: Outlook e Gmail (07/11/2026)
Richiesta del CEO: scorrere la rubrica Gmail (fraepi@gmail.com) e i contatti Outlook di francesco.epifani@ quando si inseriscono i
referenti. Componente core `CercaRubrica` (guida, permessi e privacy in docs/RUBRICHE.md):
- **Referenti > "+ Referente" e modifica**: in testa al form "Cerca il referente in rubrica" con risultati raggruppati per Suite
  (persone dell'anagrafica e referenti già presenti negli account), Outlook e Gmail; il clic compila nome e cognome, ruolo, email e
  telefono (fisso e cellulare nello stesso campo, "055 … · cell. 333 …"); se l'azienda del contatto è nota e le note sono vuote, le note
  diventano "Azienda (da Outlook)". Tutto resta modificabile prima di Salva. Sotto l'email, se quella scritta a mano è di un contatto
  Outlook (o Gmail), compare "Trovato in Outlook" con "Completa i campi".
- **Provenienza**: i referenti creati dalla rubrica hanno `contatti.fonte` = `RUBRICA_OUTLOOK` o `RUBRICA_GMAIL` (in elenco: "da
  Outlook", "da Gmail"); in modifica la provenienza non cambia. Nessuna migrazione: `fonte` è già TEXT.
- **Registra contatto > Con chi**: se il referente non è in elenco, "Non è tra i referenti? Cercalo in rubrica e crealo" apre i campi
  precompilati del nuovo referente; "Crea il referente e usalo" lo aggiunge all'account (POST `/hub/accounts/:id/contatti`) e lo seleziona
  nella tendina. Il referente resta anche se poi si annulla la registrazione del contatto.
- Accesso: chi ha il Business Hub (personale interno) e gli amministratori; gli esterni no. Si salva solo il contatto scelto.

## Anagrafica unica: contratto PP ↔ Sedi e fine dei contratti SEDE (08/11/2026)
Programma "anagrafica unica" (decisioni 2, 3 e 4 del CEO dell'08/11/2026). Regola di governo in docs/ANAGRAFICA.md.
- **Contratto PP ↔ Sedi (A1, lib/contrattoSede.js).** Alla firma (contrattualizzazione PP, stato FIRMATO/AUTORIZZATO/ATTIVO dalla scheda
  o manuale, PDF firmato caricato su un PP senza account) la sede del contratto diventa in Amministrazione > Sedi `tenure = OSPITATA` con
  Legal entity ospitante = controparte, se non ha ospitante, tramite `saveSite` (audit, Cash, perimetri del partner; evento
  `SEDE_ALLINEATA` nel contratto). Se l'ospitante è un'altra Legal entity: avviso (evento `SEDE_AVVISO`), nessuna scrittura. Alla
  creazione solo la verifica (`coerenza_sede` nella risposta). Al CESSATO senza un altro contratto PP non annullato sulla stessa sede la
  sede si chiude (`active=false`, `closed_at` = data di cessazione; evento `SEDE_CHIUSA` con il quadro d'impatto); ANNULLATO non chiude.
  Pagina Punti Prelievo: colonna "Coerenza con Sedi" (coerente, da impostare, ospitante diverso, senza sede).
- **Contratti SEDE eliminati (A3).** Non si creano né si modificano più (enum senza SEDE, `PUT`, caricamento file e pacchetti rifiutati con
  il rimando ad Amministrazione > Sedi; `HAS_DOSSIER` solo PP). I contratti esistenti restano in sola lettura con l'avviso "da migrare"
  finché il titolare non esegue in Amministrazione > Diagnostica anagrafica l'operazione "Contratti SEDE del Business Hub": **Prova**
  (`GET /api/admin/migrazioni/sede-business`, rapporto campo per campo Business/Sedi, piano dei file, fascicoli) ed **Esegui**
  (`POST … { conferma: 'ESEGUI' }`, solo titolare): fascicoli staccati e conservati (evento nel fascicolo), PDF portati in
  `site_documents` riusando byte o blob (FIRMATO → contratto se la sede non ne ha, PLANIMETRIA → planimetria se manca, il resto ALTRO; mai
  sostituire i correnti), solo i campi vuoti della locazione riempiti con `scriviSede` (per ogni differenza **vale Sedi**), spese,
  registrazione e note accodate alle note delle garanzie, ISTAT al contratto Finance Management, audit `BUSINESS_SEDE_MIGRATED` con il contratto
  completo, cancellazione diretta, poi vincoli `contracts_kind_check` (PP, SRV, MDL) e `contracts_site_required_check` (solo PP). Verifiche
  restituite: contratti SEDE rimasti, fascicoli senza sede né Legal entity, PDF firmati presenti in Sedi.
- **Sedi TD in locazione** (voce di menu invariata, `/business/sedi`): vista in sola lettura per tutti gli utenti del modulo
  (`GET /api/business/sedi-locazione`): canone e periodicità, locatore, decorrenza, fine del primo periodo, **disdetta entro** (fine meno
  preavviso), canone vigente e prossimo scatto da Finance Management, PDF del contratto (`/api/business/sedi-locazione/:id/contratto`), fascicolo;
  "Apri in Sedi" per gli amministratori.
- **Flagship (decisione 4).** "Avvia il punto prelievi" legge la locazione dalla sede (`locazioneSede`): nessun blocco, avviso nella scheda,
  nel diario e nella risposta se la sede in locazione non ha il PDF o il canone in Sedi.

## Clienti attivi, sede SERVICE e codice StudioLAB (08/11/2026, anagrafica unica blocco 2)
- **Clienti** (menu della linea): per Service e Medicina del Lavoro l'elenco è la vista unica della Suite `public.clienti_attivi_v`
  (attivi = flag del CEO; contrattualizzati = contrattualizzazione o contratto della linea firmato/attivo non cessato), la stessa di
  Ordini, NC, Portale e Circolari (docs/ANAGRAFICA.md, blocco 2); i Punti Prelievo restano sulla regola della linea. Nuova colonna
  "Codice StudioLAB" (con "da inserire" e "senza sede SERVICE") e avviso con il numero dei clienti senza codice.
- **Sede SERVICE alla contrattualizzazione**: la contrattualizzazione Service crea la sede SERVICE del cliente in Amministrazione > Sedi
  (nome = ragione sociale, indirizzo del contratto se indicato altrimenti della Legal entity, orari di ritiro dal contratto, codice
  StudioLAB se già inserito), con una riga nel diario e `sede_service` nell'esito; l'avviso "crea la sede SERVICE e premi Riallinea
  perimetri" non serve più. Per i clienti già attivi: Amministrazione > Diagnostica anagrafica, "Crea le sedi SERVICE mancanti".
- **Medicina del Lavoro**: la firma del contratto MDL (PDF firmato caricato sul contratto o stato Firmato/Attivo) contrattualizza
  l'account (data della firma), lo toglie dai prospect, lo porta alla fase 6 e crea la sede SERVICE (`MDL-<codice>`); niente email né
  profilo degli accessi automatici (da definire per la linea). Il cliente MdL compare in Ordini, NC, Portale e Circolari (segmento
  Medicina del Lavoro).
- **Cambio di stato** di un contratto Service o MdL a Firmato/Attivo (anche manuale): account fuori dai prospect, fase 6, sede SERVICE.
- **Codice StudioLAB** nella scheda account (riquadro sopra i riquadri dell'account, linee SRV e MDL): "Inserisci"/"Modifica" per chi
  gestisce la linea; si salva nella sede SERVICE (o nell'account finché la sede non c'è); un codice già usato da un'altra sede è
  rifiutato. API `PUT /api/business/hub/accounts/:id/studiolab { codice }`; il dettaglio dell'account espone `codice_studiolab`,
  `sede_service_id`, `sedi_service`, `cliente_livello`.
- Strutture del gruppo: diventano sedi SERVICE quando sono attivate (fase 6 o 7 nel DB Opportunità o punto del contratto firmato), con
  l'operazione della Diagnostica; finché non partono restano nell'elenco dell'account.


## Anagrafica unica, blocco 3 (08/11/2026)
- Punti Prelievo: colonna "Royalty in Cash" e modale di conferma della proposta dai termini del contratto PP (`fee.items`), annotata alla
  firma negli eventi del contratto; mai scritta senza conferma, mai sovrascritta senza "Sovrascrivi" (docs/ANAGRAFICA.md, B13).
- Data di avvio effettiva del punto = apertura della sede in Amministrazione > Sedi (B1).
- Contratto Service: punto service e ritiro dalla sede SERVICE del cliente quando c'è (B14).
- Nuovi account: la Legal entity nasce da `createOrganization` (doppioni ritrovati; partner dei punti prelievo di tipo PARTNER, B5).
- Referenti collegati alle persone dell'anagrafica per email (B7); Laboratorio dalla sede LABORATORIO (B9).
- Fascicoli: orari e personale precompilati dalla sede e dalle persone (C2).

## Regole del CEO dell'08/11/2026 (v0.60.0)
- **Clienti (Service e Medicina del Lavoro): SOLO i clienti attivi**, cioè con la fase 7 confermata dal CEO (`accounts.cliente_attivo`).
  I contrattualizzati in avvio restano in Pipeline e in Clienti e prospect (fase 6). `GET /hub/clienti-attivi?linea=SRV|MDL`.
- **Punti e centri attivi (sezione Punti Prelievo)**: TUTTE le sedi attive di Toscana Diagnostica di tipo punto prelievi, centro medico,
  centro diagnostico e poliambulatorio dall'anagrafica Sedi, con titolo, ospitante, apertura, responsabile, contratto PP, fascicolo e la
  scheda del Business Hub quando c'è (`accounts.pp_site_id`). `GET /hub/clienti-attivi?linea=PP` (`puntiECentriAttivi`).
- **Ogni contratto SRV/MDL con controparte ha la sua scheda nella sezione della linea** (`lib/contrattualizza.js accountDaContratto`):
  alla creazione del contratto, alla generazione della proposta e a ogni cambio di stato; fase dallo stato (bozza 3, proposta 4 alla data
  della proposta, firmato/attivo 6 con sede SERVICE), mai indietro. Job `business:schede-dai-contratti` ogni 6 ore e controllo
  Diagnostica **D12b** con "Crea le schede" per i contratti esistenti (caso CNA Firenze e ACF Fiorentina, Medicina del Lavoro).
- Il widget Payments si chiama **Finance Management** (chiave `finance` invariata, migrazione core 047).

## Richieste del CEO del 09/11/2026 (v0.66.0)
**B. "Sedi TD in locazione non serve. I punti prelievo/centri medici li hai già: sono sedi."**
- Menu della sezione Punti Prelievo (`meta.js`): tolte "Sedi TD in locazione" e "Punti e centri attivi"; resta **"Punti Prelievo e Centri"**
  (`/business/punti-prelievo`) con il contatore "fascicoli aperti". La pagina `/business/sedi` (locazioni) resta raggiungibile solo da
  Amministrazione > Sedi, pulsante "Locazioni"; `/business/clienti-attivi?linea=PP` porta alla pagina nuova.
- **Una pagina sola che parte dalle SEDI** (`pages/PuntiPrelievo.jsx`, `GET /hub/punti-centri`, `puntiECentri` in `lib/puntoPrelievi.js`): tutte le
  sedi attive di tipo PUNTO_PRELIEVI, CENTRO_MEDICO, CENTRO_DIAGNOSTICO, POLIAMBULATORIO più quelle in apertura (non attive con `opened_at`
  futura). Per ogni sede: tipo (flagship/corner), titolo di godimento e ospitante/partner, apertura, responsabile (organigramma), area TuoTempo
  (abbinata o no, docs/RETAIL_TUOTEMPO.md) e, se c'è l'account PP (`accounts.pp_site_id`), fase, contratto PP, fascicolo, avvio e royalty.
  Filtri per tipo, "con il processo", "in apertura", "senza area TuoTempo"; in fondo i processi senza sede (account PP nati prima della sede).
- **Azioni del processo con l'account creato al volo** (`POST /hub/punti-centri/:siteId/account { azione, partner_org_id? }`, `accountPerSede`,
  idempotente): "Avvia il processo con un partner" (scelta della Legal entity: account sul partner con `pp_tipo_previsto = CORNER`; `tipoPunto`
  considera corner previsto la sede non ancora ospitata, che diventa Ospitata dal partner alla firma del contratto PP, A1), "Contratto PP"
  (form del contratto con sede e controparte precompilate), "Fascicolo" (fascicolo della sede o nuovo con `?site=&org=`), "Avvia il punto
  prelievi" (flagship: data di avvio e passi c-g), "Scheda in Amministrazione". La sede non deve "diventare" un punto prelievi: il processo vale
  anche per centri medici, centri diagnostici e poliambulatori (`SEDI_PUNTO`; collegamento della sede e `da-sede` accettano i quattro tipi).
- **Nessun "Nuovo punto prelievi"** dal Business Hub: le sedi nascono solo in Amministrazione > Sedi (pulsante "Nuova sede in Amministrazione").
  La scheda account (scheda "Punto prelievi": fascicoli, contratto al partner, email, avvio) resta la scheda del processo.

**C. "Legal entity che ho in anagrafica come cliente non le ritrovo in Business Hub B2B" (es. UNIFARM SPA, SER0033).**
- Regola: ogni Legal entity di tipo CLIENTE attiva ha almeno un account (`lib/schedeAnagrafica.js`). L'account mancante nasce come prospect in
  fase 0 (censito), `fonte_censimento = 'Anagrafica'`, linea dal codice (SER → SRV, MDL → MDL, PP → PP, altrimenti SRV) e attività SISTEMA
  "Scheda creata dall'anagrafica".
- Chi la crea: il **core** alla creazione (`createOrganization`, opzione `schedaBusiness`, predefinita sì; non dentro la transazione di un
  chiamante; i chiamanti del Business Hub la spengono perché creano l'account della linea giusta) e al cambio di tipo in CLIENTE o alla
  riattivazione (`PUT /api/organizations/:id`), con `hookBusinessLegalEntity` (import dinamico con try/catch, solo con il Business Hub LIVE:
  nessuna dipendenza rigida); il **job `business:schede-da-anagrafica`** (all'avvio e ogni ora); la **Diagnostica D47** "Legal entity cliente
  senza scheda nel Business Hub" con "Crea le schede".
- Scheda Legal entity in Amministrazione: sezione "Business Hub" con "Apri nel Business Hub" per ogni account (linea, fase, se creata
  dall'anagrafica) e **"Aggiungi la linea …"** (Service o Medicina del Lavoro) per un secondo account (`GET|POST /api/organizations/:id/business`).
- Clienti e prospect (e Pipeline): filtro **"Da anagrafica (censiti)"** (`?origine=anagrafica`: schede create dall'anagrafica ancora in fase 0)
  e badge "da anagrafica · codice" sulla riga.

**Collaudo del 09/11/2026** (db `suite_tt_t`, porta 3162): pagina con 6 sedi (5 attive + 1 in apertura, niente laboratorio), area TuoTempo per 4;
"Avvia il processo con un partner" su PP-EMP (account creato al volo, seconda azione idempotente, scheda: corner previsto) e dall'interfaccia sulla
sede in apertura; flagship su un centro medico con "Avvia il punto prelievi" (4/5 passi: il primo ordine non riesce perché Ordini non è avviato
nel collaudo, come previsto); `/api/business/sedi-locazione` 200; D47 = 2 prima del job (SER0033, MDL0901), hook alla creazione (SRV) e al
cambio di tipo FORNITORE → CLIENTE (MDL), job "2 create", D47 = 0; "Aggiungi la linea Medicina del Lavoro"; filtro "Da anagrafica (censiti)".
Schermata `docs/screens/business-punti-centri.png`.

**Verifiche in produzione**: D47 (atteso > 0 al primo avvio, poi 0 dopo il job; UNIFARM SPA in Clienti e prospect con "Da anagrafica
(censiti)"); che le Legal entity CLIENTE create in passato per Spedizioni (richiedenti) siano davvero clienti: ora ricevono una scheda come le
altre (se non lo sono, cambiarne il tipo); pagina Punti Prelievo e Centri con tutte le sedi; "Locazioni" da Amministrazione > Sedi.

## Clienti Synclab e perimetro B2B (09/11/2026, Synclab Data API)
I client del gestionale importati con la Data API (`synclab.clients`) si abbinano alle Legal entity nella vista `synclab.clients_td`:
proposta dal codice StudioLAB della sede (stessa regola del ponte B2B di Retail), poi da partita IVA o codice fiscale di una sola Legal
entity; conferma ("Abbina") o scelta a mano ("Scegli") in Amministrazione > Connettori > Dati Synclab > Clienti Synclab.
**Perimetro B2B della Suite** = client abbinati a una Legal entity CLIENTE attiva con livello ATTIVO o CONTRATTUALIZZATO (clienti_attivi_v,
attraverso `public.cliente_livello`), più quelli inclusi a mano, meno quelli esclusi a mano. `occupationalMedicine` resta il flag della
medicina del lavoro e non decide il perimetro. Diagnostica: D48 (client senza Legal entity), D50 (Legal entity cliente attiva senza client
Synclab). Regola da confermare con il CEO. Dettagli: docs/SYNCLAB_DATA_API.md.

## Correlazione con StudioLab (Synclab) e "FY atteso" dichiarato (09/11/2026 sera, v0.68.1)
Per i clienti **Service e MdL** con la Legal entity abbinata a un client Synclab (`synclab.clients_td`) la Suite affianca al dichiarato ciò
che il gestionale ha registrato (`lib/synclabAccount.js`, test `server/test/v0681-correlazioni.test.mjs`):
- **Scheda account**, riquadro "Dal gestionale (Synclab)" (`components/SynclabAccount.jsx`, `GET /api/business/hub/accounts/:id/synclab`):
  fatturato **maturato** dell'anno (`netRevenueContribution` una volta per documento con data nell'anno, `fatturatoPerOrg`), produzione
  dell'anno (esami e valore netto, `produzionePerOrg`) mese per mese con l'ultimo mese, **pro quota** dell'anno = `fatturato_fy_atteso` ×
  giorni lavorativi (lun-ven) dall'avvio (data di avvio effettiva, prevista o di cliente attivo; il 1° gennaio se è precedente o manca) /
  giorni lavorativi dell'anno (`hub_giorni_lavorativi`, 250, come `volumiGiornalieri`), scostamento in euro e %, **run rate** dell'anno
  seguente = media mensile degli ultimi 3 mesi pieni × 12 (con almeno 2 mesi pieni; "mese pieno" = mese trascorso e interamente dopo
  l'avvio; senza data di avvio dal primo documento) contro il dichiarato, con la nota quando i mesi sono pochi. Collegamento alla scheda
  B2B di Retail (`/retail/b2b/clienti/:id`). Schermata `docs/screens/business-account-synclab.png`.
- **Semaforo** dello scostamento sul pro quota: verde entro ±10% (o sopra), giallo fino a −25%, rosso oltre.
- **Pipeline**: le colonne mostrano il "FY atteso (dichiarato nelle schede)"; le schede dei clienti attivi abbinati hanno la riga maturato
  dell'anno · pro quota · scostamento % · semaforo; la colonna 7 somma anche il maturato. Filtro **"Solo in ritardo"** (giallo o rosso;
  `GET /hub/accounts?ritardo=1` o `?ritardo=1` nella pagina). Schermata `docs/screens/business-pipeline-synclab.png`.
- **Cruscotto**: "In pipeline" con "FY atteso (dichiarato nelle schede)"; "Clienti attivi" con il FY atteso dichiarato e il **Maturato
  dell'anno (Synclab)** dei clienti attivi abbinati, il loro pro quota e quanti sono in ritardo (`synclab` nella risposta di `/cruscotto`).
- **Diagnostica D51** "Clienti attivi con maturato Synclab sotto il 75% del pro quota" (INFO, collegamento alla scheda account), stesse
  regole in SQL.
- Lettura non riuscita o copia vuota = nota, mai uno zero. Da verificare in produzione: che l'abbinamento dei client copra i clienti attivi
  (D48, D50) e che la data di avvio sia compilata (senza, il pro quota parte dal 1° gennaio).

### v0.68.5 (CEO 10/11/2026): maturato = produzione erogata, listini del gestionale, codice StudioLab
- **Maturato = PRODUZIONE EROGATA** ("Maturato 2026: NON il fatturato ma il valore netto, cioè il valore della produzione erogata per mese,
  aggiornato per singolo giorno"): nel riquadro "Dal gestionale (Synclab)" il KPI è "Maturato 2026 (produzione erogata)" = accettazioni in
  stato erogato dell'anno, netto di riga × quantità × (1 − sconto di testata) (definizione unica: docs/SYNCLAB_DATA_API.md "Produzione
  erogata"); progressione **giornaliera** del mese in corso (barre) e **mensile** dell'anno (tabella con produzione, esami, accettazioni e,
  in grigio, i documenti emessi come dato secondario mai sommato); **pro quota, scostamento, semaforo e run rate** calcolati sulla produzione
  erogata (run rate senza data di avvio: dalla prima accettazione erogata). Stessa grandezza nella Pipeline (riga maturato), nel Cruscotto
  ("Maturato 2026 (produzione erogata)") e nella Diagnostica **D51** (SQL con `synclab.stati_erogati()`). Fonte sotto il riquadro con
  "aggiornato alle HH:MM".
- **Listino del gestionale (Synclab)** nella scheda **Listino e offerta** dei clienti Service e MdL abbinati (`components/GestionaleSynclab.jsx`
  `ListinoGestionale`, `GET /hub/accounts/:id/listino-synclab`): per ogni client del gestionale il listino base (`priceListId`) ed extra
  (`extraPriceListId`) con codice, descrizione, stato (bozza, in revisione, approvato, annullato), tipo, numero di righe, anteprima, confronto
  con il listino corrente del Business Hub (prezzo offerto, altrimenti di listino: prezzi diversi, uguali, solo nel gestionale, solo nel
  Business Hub, con l'elenco delle differenze) e **"Scarica XLSX"** (`/hub/accounts/:id/listino-synclab.xlsx`: Riepilogo, un foglio per
  listino con codice esame, descrizione, prezzo lordo, sconto %, prezzo netto, IVA, i fogli di confronto e le note; decimali esatti).
- **Clienti > "Listini del gestionale (XLSX aggregato)"** (`/hub/listini-synclab.xlsx?linea=SRV|MDL`): foglio **Riepilogo** (cliente, codice
  StudioLab, ragione sociale nel gestionale, listino, ruolo, stato, righe) con in fondo i **listini Synclab non associati ad alcun client
  abbinato**, e **un foglio unico lungo cliente × esame** (scelta: più usabile in pivot) con cliente, codice StudioLab, listino, ruolo e le
  colonne del listino. Solo i clienti del **perimetro B2B** (clienti attivi o contrattualizzati abbinati, più gli inclusi a mano); con la linea,
  le Legal entity con un account di quella linea. Decimali come nel gestionale.
- **Codice StudioLab e client del gestionale** (CEO: "Perché in Business Hub lato service e lato Punti Prelievo non li associ correttamente
  al codice StudioLab relativo? Correggi!"): ogni account Service/MdL mostra sotto il codice StudioLAB le sedi SERVICE con il loro codice (più
  sedi: tutte) e i client Synclab abbinati (codice, ragione sociale nel gestionale, attivo, sede); **"Abbina al cliente del gestionale"**
  propone i client con le regole dell'allineamento automatico (ambigui compresi) e la sede giusta, e scrive il codice nella sede se manca
  (`GET/POST /hub/accounts/:id/abbina-synclab`, attività SISTEMA nel diario). **Clienti** (Service e MdL): colonne "Codice StudioLAB" (con le
  sedi se più d'una) e "Client nel gestionale", filtro **"Solo senza codice StudioLAB"**. **Punti Prelievo e Centri**: colonna "Codice
  StudioLAB" della sede con il client del gestionale corrispondente, filtro "Senza codice StudioLAB" e conteggio nel riepilogo. Fonte unica
  resta `public.sites.studiolab_code`; l'abbinamento automatico (job `synclab:abbinamenti`, docs/SYNCLAB_DATA_API.md) lo scrive quando è
  univoco. D48/D50 aggiornati (motivo ambiguo/nessun candidato; codice della sede e presenza nel gestionale).
- Schermata `docs/screens/business-account-synclab.png` (v0.68.5). Test `server/test/v0685-produzione-erogata.test.mjs`.

## v0.68.6 · Maturato = produzione accettata
Il maturato dell'anno (scheda account, Pipeline, Cruscotto, D51) usa la **produzione accettata** del gestionale (docs/SYNCLAB_DATA_API.md,
"v0.68.6"): stati dell'impostazione `stati_erogati` (predefiniti tutti tranne 11), importi di riga con lo sconto di testata solo se
`sconto_testata` = APPLICA (il D51 lo legge con `synclab.sconto_testata_applicato()`). Pro quota, run rate e semaforo non cambiano regola. Il
Cockpit conta i "clienti in ritardo sul pro quota" con lo stesso semaforo (giallo o rosso). Etichette: "Maturato … (produzione accettata)".

## v0.71.0 · Collegamento con Lab Control (CEO 12/11/2026)
- Scheda account, blocco "Dal gestionale (Synclab)": pulsante **"Accettazioni in Lab Control"** con il filtro della Legal entity (tutti i suoi
  client Synclab), accanto a "Scheda B2B in Retail". Il link lo costruisce il server (`GET /api/business/hub/accounts/:id/synclab`, campo
  `lab_control`) solo se Lab Control è LIVE e l'utente ne ha il grant (Owner e Admin della Suite sempre); altrimenti il pulsante non c'è.
- In Lab Control il clic sul nome di un cliente apre la scheda account del Business Hub della Legal entity abbinata (`synclab.clients_td`;
  con più account un elenco per linea; senza account la scheda della Legal entity; client non abbinato: "Abbina"). Dettagli in LAB_CONTROL.md.
