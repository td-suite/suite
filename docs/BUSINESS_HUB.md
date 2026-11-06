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
I contratti restano nel gruppo "Contratti e autorizzazioni" del menu (la vecchia home è "Panoramica contratti").

Scheda account: intestazione con linea, fase e date di fase, cliente attivo (interruttore solo per CEO/Admin), owner, prossima azione;
schede Diario ("Registra contatto": tipo, quando, con chi, cosa ci siamo detti, esito, prossima azione, contratto, allegati), Referenti,
Criticità (manuali + NC), Ordini, Non conformità, Ticket, Circolari, Portale, Contratti e Fascicoli (di cui), Documenti, Email ("Scrivi al
cliente"), Pacchetto di benvenuto, Dati economici, Dati commerciali con le strutture del gruppo.

## Proposte modificabili (AgapeLab)
Perché il CEO non trovava "nessun modo per modificare" la proposta di AgapeLab: il contratto è arrivato dai pacchetti in stato ATTIVO e
la scheda mostrava "Modifica" e "Rigenera" solo in BOZZA e PROPOSTA (il server rifiutava la PUT con "Il contratto è già firmato"); in più
alla Legal entity mancava il firmatario, quindi la generazione rispondeva "Dati incompleti". Ora:
- BOZZA e PROPOSTA: "Modifica" e "Rigenera DOCX e PDF" come prima (chi gestisce la linea).
- FIRMATO, AUTORIZZATO, ATTIVO: un Admin del modulo usa "Modifica (nuova revisione)" con un **motivo obbligatorio**: la versione
  precedente va in `contract_revisions` (dati e motivo), la versione cresce, lo stato non cambia; "Genera documento vN" produce i nuovi
  DOCX e PDF lasciando quelli delle versioni precedenti. Cessati e annullati non si modificano.
- "Cambia stato" (Admin del modulo o Owner): qualunque stato con motivazione obbligatoria (`POST /contracts/:id/stato-manuale`, evento
  STATO_MANUALE). Non cambia il cliente attivo.
- La scheda contratto porta all'account ("Account nel Business Hub") e mostra lo storico delle revisioni.
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
`POST /hub/import/db/prova`, `POST /hub/import/db/esegui`, `GET|POST /hub/accounts/:id/pacchetto`, `GET|PUT /hub/pacchetto/modelli`, `GET /hub/import/db/runs`, `POST /hub/import/contratti`, `GET /hub/caselle`,
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
