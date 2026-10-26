# Modulo Ticket · richieste e segnalazioni ai responsabili

Modulo nativo della Suite (chiave `ticket`, area HQS, dopo Circolari). Si avvia vuoto da Amministrazione > Travaso moduli >
"Avvia il modulo" (è in `FRESH_MODULES`). Chiunque sia autenticato nella Suite apre ticket e segue i propri, anche senza grant sul
modulo; i responsabili delle unità dell'organigramma (caselle) li gestiscono; l'amministratore del modulo governa categorie, SLA e
impostazioni. Protocollo `TK-AAAA/NNNN`, progressivo annuale assegnato dal database all'apertura.

## Cosa fa
1. **Apertura** (`POST /api/ticket/tickets`). Il richiedente sceglie la categoria (che propone priorità e casella destinataria),
   scrive titolo e descrizione, indica "per conto di" una sede TD (`public.sites`) o una Legal entity (`public.organizations`) con
   proposta dalla sua scheda persona, allega file (pdf, png, jpg, webp, docx, xlsx, txt, csv; 10 MB; 10 per ticket, BYTEA nello
   schema del modulo). Se la categoria non ha una casella predefinita il richiedente la sceglie dall'albero (`org_unit_path`).
   Le categorie riservate rendono il ticket riservato; il richiedente può chiedere di non mostrare il nome fuori dalla casella
   (`anonimo`). Avviso privacy e nota sul canale whistleblowing (D.lgs. 24/2023) sono testi modificabili in Impostazioni.
   Limite: 20 aperture al giorno per utente (impostazione `max_aperture_giorno`, risposta 429).
2. **Gestione.** I gestori (responsabili della casella destinataria e delle caselle superiori, assegnatario, ADMIN) prendono in
   carico, assegnano (a chi afferisce alla casella o a una discendente, o a sé), girano ad altra casella con motivo (assegnazione
   azzerata, stato APERTO, prima risposta già data conservata), cambiano priorità (SLA ricalcolati dall'apertura più il tempo in
   attesa), mettono IN_ATTESA (scadenza di risoluzione congelata: alla ripresa si sposta in avanti del tempo fermo, registrato
   nell'evento con l'intervallo), risolvono con messaggio al richiedente, scrivono note interne (invisibili a richiedente e
   osservatori, anche gli allegati delle note e gli eventi NOTA).
3. **Richiedente.** Commenta, allega, modifica titolo e descrizione finché APERTO, annulla finché APERTO, conferma la
   risoluzione (CHIUSO, con valutazione 1..5 facoltativa e nota) o riapre entro 7 giorni da RISOLTO (IN_CORSO, `riaperture + 1`).
4. **Prima risposta**: presa in carico, assegnazione o primo commento pubblico di un gestore; anche la risoluzione la imposta se manca.
5. **Job periodico** (`registerJob('ticket:sla', 15 min)`, scheduler della Suite, `DISABLE_SCHEDULER` lo ferma; eseguibile a mano
   da Impostazioni o `POST /api/ticket/admin/job`): marca `sla_risposta_sforato` / `sla_risoluzione_sforato`, escalation
   (risoluzione sforata, nessuna presa in carico, nessuna escalation precedente → `escalation_unit_id` = casella superiore, evento,
   notifica ai suoi responsabili; disattivabile con `escalation_attiva`), chiusura automatica dei RISOLTI dopo N giorni
   (`chiusura_automatica_giorni`, default 7; 0 disattiva). Un secondo job (`ticket:reindex`, 60 min) riallinea l'indice di ricerca.
6. **Notifiche**: `notify()` della Suite (kind TICKET, link `/ticket/<id>`) più `sendMail` (ref `ticket:<id>:<evento>`) a chi ha
   `notify_email`: responsabili della casella all'apertura, al giro e all'escalation; richiedente a presa in carico, assegnazione,
   commento pubblico, cambio di stato, risoluzione, chiusura, annullamento; assegnatario all'assegnazione; osservatori ai commenti
   pubblici e alla risoluzione. Per i riservati le email portano solo protocollo e link, mai titolo né testo; l'autore dell'azione è
   sempre escluso.
7. **Statistiche** (`GET /stats?da=&a=&unit_id=`): totali per stato, priorità, categoria, casella (con percorso, sforati, ore medie),
   struttura (sede / Legal entity); tempi medi di prima risposta e risoluzione (al netto delle attese); % SLA rispettati; in ritardo
   adesso; backlog per età (0-2, 3-7, 8-30, >30 giorni); andamento 12 mesi (aperti / risolti o chiusi); valutazione media; top 5
   caselle per carico. Sempre sui soli ticket visibili all'utente.
8. **Esportazioni**: `GET /export/tickets.xlsx` (stessi filtri della lista, 27 colonne, foglio Statistiche; descrizione omessa per i
   riservati), `GET /tickets/:id/scheda.pdf` (scheda con SLA, commenti e cronologia visibili all'utente), `GET /export/rapporto.pdf`
   (rapporto di periodo, una pagina per sezione). PDF con pdfkit, font LiberationSans e logo di `shipments/assets` come
   `lib/orgchartExport.js`; XLSX con exceljs.
9. **Ricerca**: full-text italiano su protocollo, titolo e descrizione (colonna generata `fts`, `websearch_to_tsquery`); i ticket non
   riservati e non annullati entrano nell'indice della Suite (kind `ticket`, audience `USERS` = richiedente, assegnatario,
   osservatori, responsabili della catena della casella e dell'escalation), riallineato a ogni modifica e dal job. I riservati non
   sono mai indicizzati.

## Visibilità
Un utente vede un ticket se è richiedente, osservatore, assegnatario, responsabile (`org_positions.is_head` o
`org_units.head_person_id`) della casella destinataria o di una casella antenata, responsabile della casella di escalation, oppure
ADMIN / VIEWER del modulo. Riservati: solo richiedente, responsabili della casella destinataria (non gli antenati), assegnatario e
ADMIN; VIEWER e osservatori esclusi (gli osservatori non si aggiungono ai riservati). Ogni lettura di un riservato da parte di chi non
è il richiedente va in `eventi` (LETTURA_RISERVATO, una per utente ogni 10 minuti per non riempire la cronologia a ogni
aggiornamento della pagina) e nell'audit della Suite (`TICKET_LETTURA_RISERVATO`). Con `anonimo` il nome del richiedente è
"Riservato" per chiunque non sia il richiedente, un responsabile della casella o l'assegnatario (anche per l'ADMIN).
Funzioni SQL del modulo: `ticket.managed_units(uid)` (caselle di cui l'utente è responsabile) e `ticket.unit_subtree(int[])`
(discendenti inclusi). `lib/access.js` del modulo costruisce il contesto per richiesta (`userContext`) e il frammento `visibleSql`.

## Accesso aperto a tutti (scelta progettuale)
Il modulo è `open_to_all` nel catalogo (`modules.open_to_all`, migrazione core `024_modules_open.sql`, seminato da
`seed/modules.js`): `GET /home/modules` lo mostra a tutti gli utenti autenticati; `ModuleFrame` lascia entrare chi non ha grant se
`meta.js` del modulo dichiara `openToAll: true`; `moduleUser` (lib/modules.js) accetta `extraColumns.openToAll` e assegna il ruolo
implicito `defaultRole` ('UTENTE', non assegnabile) invece di rifiutare con 403. Owner e Admin della Suite sono ADMIN del modulo.
Il potere di gestione viene dall'organigramma (`is_head`), non dal profilo: il profilo RESPONSABILE del catalogo serve alle regole di
accesso (`grantRules`: responsabili di unità → RESPONSABILE; HSQ Management → ADMIN) e alla leggibilità in Amministrazione > Utenti.
La voce "Da gestire" della sidebar compare in base al flag `gestore` di `GET /badges` (Shell.jsx: voce con `flag` nascosta se il
badge è 0), così non dipende dal grant.

## Schema `ticket`
`users` (riga tecnica), `categorie` (unit_id → public.org_units, priorita_default, riservata), `sla` (P1..P4, ore), `tickets`
(FK verso public.users, public.people, public.sites, public.organizations, public.org_units; `attesa_secondi` e `attesa_da` per il
congelamento dello SLA; `anonimo`; `fts`), `commenti` (interno), `allegati` (BYTEA, commento_id), `eventi` (tipo, user_id NULL =
sistema, dati JSONB), `osservatori`, `impostazioni` (key/value). Seed: 10 categorie senza casella predefinita (la imposta
l'amministratore), SLA P1 4/24, P2 8/72, P3 48/240, P4 120/720, impostazioni.

## Profili
ADMIN (tutto, Impostazioni), RESPONSABILE (responsabile di unità: cosmetico, vedi sopra), VIEWER (consultazione di tutto, riservati
esclusi), UTENTE implicito (apre e segue i propri ticket, osserva).

## Collaudo locale (26/10/2026)
Istanza su :3107, titolare + due utenti locali di prova (responsabile di Core Lab e utente semplice, rimossi alla fine). 95 controlli
automatici superati: catalogo (10 categorie, 4 SLA, 35 unità); apertura TK-2026/0001 per conto di LAB verso Core Lab con SLA
P2 (+8 h / +72 h); presa in carico, commento pubblico, nota interna invisibile al richiedente (commenti, eventi, allegato della
nota: 403); allegato pdf accettato, .exe rifiutato; IN_ATTESA e ritorno con scadenza spostata del tempo fermo; cambio priorità P1
con ricalcolo (24 h + attesa); RISOLTO, riapertura, chiusura con valutazione 5; riservato con evento di lettura e audit (2 letture
= 2 righe di audit), nome "Riservato" all'ADMIN fuori dalla casella, email senza testo; giro a Preanalitica (Core Lab perde la
visibilità); escalation simulata (scadenze nel passato → casella superiore, flag sforati); chiusura automatica dopo 7 giorni;
statistiche per i tre ruoli; XLSX (2 fogli), scheda PDF (2 pagine) e rapporto PDF (5 pagine) controllati con pdftoppm; ricerca
full-text e indice della Suite (4 voci, riservati e annullati esclusi; l'utente semplice non trova i ticket altrui); rate limit (429 al
quarto ticket con limite 3). Build Vite pulita; Playwright su home e tutte le pagine del modulo per tre utenti senza errori console
(a parte i 401/403 attesi) né 500; schermate in `docs/screens/mod-ticket-*.png`.

## Da fare
- Le regole di accesso iniziali per `ticket` si seminano solo su un database con `grant_rules` vuota: su un'installazione già
  avviata vanno aggiunte da Amministrazione > Organizzazione > Regole di accesso (responsabili di unità → RESPONSABILE, HSQ → ADMIN).
- BYTEA degli allegati nello schema del modulo: migrazione su Azure Blob nella fase 2, come per Circolari.
- Calendario lavorativo per gli SLA (oggi ore solari) e promemoria al gestore prima della scadenza.
- Collaudo delle email in produzione (in locale `MAIL_PROVIDER=log`).
