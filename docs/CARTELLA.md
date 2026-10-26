# Modulo Cartella condivisa · documenti per tutti

Modulo nativo della Suite (chiave `cartella`, area Retail & Flow, dopo Comunicazione). Si avvia vuoto da Amministrazione > Travaso
moduli > "Avvia il modulo" (è in `FRESH_MODULES`). Una cartella di documenti comune a chi ha il grant sul modulo: cartelle ad albero,
documenti con versioni, "in evidenza" con scadenza, "novità" per utente. Richiesta del CEO: nessun permesso per cartella, chi vede il
widget vede tutto; il widget lo vede solo chi ha il grant (`open_to_all` FALSE, a differenza di Ticket).

## Cosa fa
1. **Navigazione** (`GET /api/cartella/cartelle/:id`, `0` o `radice` = radice): sottocartelle (con conteggio dei documenti nel
   sottoalbero e dei nuovi per l'utente), documenti (con `letto`, `nuovo`, `evidenza_attiva`, `n_letture`, percorso), catena del
   percorso per il breadcrumb. `GET /albero` dà tutte le cartelle con conteggi (tendina ad albero della gestione).
2. **In evidenza** (`GET /evidenza`): documenti con `in_evidenza` e `evidenza_fino` NULL o non passata, ordinati per aggiornamento;
   compaiono anche in cima alla cartella principale. **Recenti** (`GET /recenti`): ultimi 20 per `updated_at`.
3. **Novità per me** (`GET /novita`, `GET /badges` → `novita`): documenti caricati negli ultimi 30 giorni (`CARTELLA_NOVITA_GIORNI`)
   senza riga in `letture` per l'utente. La lettura si registra alla prima apertura o download (`letture`, chiave documento + utente):
   serve anche al "letto da N persone". Chi carica un documento lo ha già letto.
4. **Apertura**: `GET /documenti/:id/download` (attachment, nome mostrato + estensione originale), `GET /documenti/:id/anteprima`
   (inline, solo PDF e immagini; 400 per gli altri tipi), `GET /documenti/:id` (scheda), `GET /documenti/:id/versioni` (corrente e
   precedenti), `GET /documenti/:id/versioni/:v/download` (versione precedente).
5. **Ricerca** (`GET /cerca?q=`): ILIKE su nome mostrato, descrizione, nome originale e percorso della cartella; anche le cartelle per
   nome e descrizione. I documenti entrano nell'indice della Suite (kind `cartella`, `ref_id cartella:<id>`, link `/cartella/doc/<id>`)
   con audience `{"type":"MODULE","key":"cartella"}`: li trova solo chi ha il grant sul modulo (e Owner/Admin). Riallineato a ogni
   scrittura e dal job `cartella:reindex` (60 minuti).
6. **Gestione** (profilo ADMIN, 403 per VIEWER): `POST /cartelle`, `PUT /cartelle/:id` (nome, descrizione, `parent_id` con controllo
   dei cicli: 400 se la destinazione è la cartella stessa o una discendente), `DELETE /cartelle/:id` (solo vuota, altrimenti 400 con
   `details.sottocartelle` e `details.documenti`); `POST /cartelle/:id/documenti` e `POST /documenti` (multer in memoria, campo `file`
   ripetuto, fino a 20 file, 50 MB ciascuno; risposta `{caricati, errori}`; con nessun file accettato 400 con lo stesso esito in
   `details`); un nome già presente nella cartella risponde `codice DUPLICATO` con `documento_id`, e con `sostituisci=1` diventa una
   nuova versione (l'interfaccia lo propone); `PUT /documenti/:id` (nome, descrizione, `cartella_id`, `in_evidenza`, `evidenza_fino`;
   409 se il nome esiste già nella destinazione); `POST /documenti/:id/versione` (un file: la versione corrente va in `versioni`,
   `versione + 1`, nome mostrato invariato, `filename` e `mime` del nuovo file); `DELETE /documenti/:id` (con lo storico);
   `GET /eventi` (ultimi 200). Tipi ammessi dall'estensione (il MIME dichiarato dal browser non conta): pdf, docx, xlsx, pptx, png,
   jpg/jpeg, webp, txt, csv, md.
7. **Audit**: ogni scrittura lascia un evento nel modulo (`eventi`: CARICATO, RINOMINATO, SPOSTATO, ELIMINATO, EVIDENZA, VERSIONE,
   MODIFICATO, CARTELLA_CREATA/RINOMINATA/SPOSTATA/ELIMINATA; senza FK, così resta dopo l'eliminazione) e una riga nell'audit della
   Suite (`CARTELLA_*`, module_key `cartella`).

## Storage: BYTEA nello schema del modulo (scelta)
`lib/blob.js` richiede `AZURE_STORAGE_CONNECTION_STRING`: senza, `putBlob` lancia 503 (`BLOB_DISABLED`) e non c'è alcun ripiego su
database; `public.files` porta `blob_path NOT NULL`. Riusare `public.files` avrebbe reso il modulo inutilizzabile in locale e in ogni
installazione senza Blob, quindi il contenuto sta in `documenti.data` e `versioni.data` (BYTEA), come gli allegati di Ticket e i
documenti di Circolari. Nessuna migrazione del core (`025_files_cartella.sql` non serve). Migrazione su Blob nella fase 2: aggiungere
`blob_path` nullable, spostare i contenuti, servire da `getBlobStream` quando presente.

## Schema `cartella`
`users` (riga tecnica, ruolo ADMIN/VIEWER), `cartelle` (parent_id → cartelle ON DELETE CASCADE, unicità `coalesce(parent_id,0),
lower(nome)`), `documenti` (cartella_id nullable = radice, nome mostrato, filename originale, mime, size, data BYTEA, descrizione,
in_evidenza, evidenza_fino DATE, caricato_da_user_id → public.users, versione; unicità `coalesce(cartella_id,0), lower(nome)`),
`versioni` (versioni precedenti con contenuto), `letture` (documento_id, user_id, letto_at), `eventi`. Funzioni `cartella.percorso(id)`
("Procedure / Qualità") e `cartella.discendenti(id)`.

## Profili e accesso
ADMIN "Gestione" (crea cartelle, carica, rinomina, sposta, elimina, mette in evidenza, nuove versioni) e VIEWER "Consultazione".
Owner e Admin della Suite sono ADMIN del modulo. Senza grant: 403 su ogni rotta e widget assente in `GET /home/modules`.
Regole di accesso iniziali (`lib/grantRules.js`, seminate solo su `grant_rules` vuota): tutti i responsabili di unità → VIEWER;
Retail & Communications Management → ADMIN; HSQ Management → ADMIN. In produzione vanno aggiunte a mano da Amministrazione >
Organizzazione > Regole di accesso.

## Web (`web/src/modules/cartella`, CSS con prefisso `cf-`)
Sidebar: Cartella, In evidenza (badge), Novità (badge), Cerca, Gestione (ADMIN), Guida. Pagina principale con breadcrumb, griglia o
elenco (scelta ricordata in localStorage), icona per tipo, dimensione, data, "nuovo", stella; sezione In evidenza in cima alla radice.
Clic su PDF e immagini → scheda `/cartella/doc/:id` con anteprima inline, Scarica, dettagli e storico delle versioni; gli altri tipi si
scaricano direttamente. Gestione (`/cartella/gestione[/c/:id]`): stessa vista con Nuova cartella, Carica file (trascinamento o
selezione, più file, proposta di nuova versione sui duplicati), menu per elemento (modifica/sposta/evidenza con scadenza, nuova
versione, scheda, scarica, elimina con conferma), Cronologia (`/cartella/gestione/cronologia`).

## Collaudo locale (26/10/2026)
Istanza su :3108 (`WEB_DIR` sulla build Vite in `/tmp/claude-0/cartella-dist`), titolare più due utenti locali di prova (VIEWER con
grant e utente senza grant, rimossi alla fine). 68 controlli automatici superati: avvio con `POST /api/travaso/cartella/run`
(`{ok, fresh}`), albero vuoto e badge 0/0; Procedure, Procedure / Qualità, Modulistica; duplicato di cartella (case-insensitive) 409;
rinomina; spostamento ciclico e in se stessa 400; spostamento e ritorno alla radice; upload di 3 file (pdf, png, txt) con MIME dal
tipo; .exe rifiutato (400, codice TIPO); duplicato 400 con `DUPLICATO` e `documento_id`, con `sostituisci=1` versione 2; upload in
radice con descrizione; contenuto e conteggi del sottoalbero; rinomina e descrizione, rinomina su nome esistente 409; evidenza con
scadenza 2099 attiva e con scadenza 2020 non attiva (esclusa da `/evidenza`); nuova versione (versione 2, filename nuovo, storico con
la 1 scaricabile con il contenuto originale, .exe rifiutato); spostamento documento, 409 su nome già presente in radice, 400 su
cartella inesistente; ricerca per nome, percorso e descrizione; VIEWER: state VIEWER, novità 4 → 3 dopo il download → 2 dopo
l'anteprima png, download attachment con contenuto della versione 2, anteprima png e pdf inline con content-type giusto, anteprima txt
400, `n_letture` 2, 403 su tutte le 9 rotte di gestione, widget presente; utente senza grant: 403 su state e download, widget assente;
ricerca della Suite: titolare e VIEWER trovano il documento (kind `cartella`), l'utente senza grant no; eliminazione di Procedure non
vuota 400 con conteggio (1 sottocartella, 2 documenti), cartella vuota eliminata; 9 tipi di evento presenti, audit della Suite con
righe `cartella`. Build Vite pulita; Playwright su home, `/cartella`, cartella, elenco, evidenza, novità, cerca, anteprima pdf e png,
gestione (con caricamento, menu e finestra di modifica), cronologia, guida, più viewer e utente senza grant: nessun errore console
(a parte i 401/403 attesi) né 500; schermate in `docs/screens/mod-cartella-*.png`.

## Da fare
- Regole di accesso in produzione (vedi sopra).
- Fase 2: contenuti su Azure Blob (`blob_path`), come per Circolari e Ticket.
- Contatore del widget in home (`/home/counters` è globale e cachato per tutti gli utenti: le "novità" sono per utente, quindi oggi il
  widget non porta un numero; i contatori sono nella sidebar del modulo).
- Anteprima testuale di txt, csv e md (oggi solo PDF e immagini) e miniature delle immagini nelle schede.
