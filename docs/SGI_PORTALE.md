# SGI Management nella Suite · copia conforme del Portale SGI

Richiesta del CEO (01/11/2026), dopo il Portale Service (v0.39.0): "Vorrei fare poi la stessa cosa con SGI! Perfettamente!". Cioè lo
stesso modello: il sito pubblico resta la fonte, aggiornato dalla routine RSGI, e la Suite lo specchia e lo presenta come widget nativo,
copia conforme, senza doppio inserimento.

## In breve
Una sola fonte, due presentazioni identiche. Il sito pubblico **sgi.toscanadiagnostica.it** (Flask, repo `td-sgi-portale`, Render) resta
la fonte dei documenti e si aggiorna come oggi con la routine RSGI (`build\aggiorna_portale.bat` → git push → Render). La Suite ne tiene
uno **specchio di sola lettura** e ne riscrive la presentazione in React (modulo `sgi`, widget HQS "SGI Management", route `/sgi`):
stesse funzioni del cruscotto, stessi testi, stessi dati. Nella Suite i documenti non si modificano: si gestiscono solo origine,
credenziali dell'origine, aggiornamento e cache.

| | Sito pubblico | Suite (`/sgi`) |
| --- | --- | --- |
| Chi lo vede | chiunque (decisione AD 01/10/2026); con `SGI_PASSWORD` su Render il cruscotto chiede utente e password, le preparazioni restano aperte | ogni utente autenticato, clienti service esterni compresi (open_to_all) |
| Contenuti | `data/{meta,docs,preparazioni,fulltext}.json` + PDF del repo | specchio dei JSON (`sgi.contenuti`) + PDF in cache (`sgi.file_cache`) |
| Link stabili | `/doc/<codice>`, `/m/<codice>`, `/p/<shortcut>` | `/sgi/doc/…`, `/sgi/m/…`, `/sgi/p/…` (stesse regole, PDF dalla cache) |
| Copia link / e-mail | link del sito | link **pubblici** del sito (chi li riceve può non avere un account della Suite) |
| Indice REG006, Mappa concettuale, Politica | PDF in una nuova scheda | PDF dentro la pagina (visualizzatore) con dati e link del documento |

## Lo specchio (meccanica comune al Portale Service)
La meccanica è in `server/src/lib/specchioPortale.js` (`creaSpecchio`, `inviaFilePortale`, `montaLinkStabili`) con le regole pure in
`server/src/lib/specchioRegole.js` (link stabili come `app.py`, JSON canonico e sha, NUL, nomi e radice dello ZIP, intestazione HTTP
Basic); i due moduli la parametrizzano (chiavi dei JSON, cartelle, messaggi, credenziali, colonne extra dello stato). Il Portale Service
la usa senza cambiamenti di comportamento (test `service-*.test.mjs` invariati e verdi).
- **Job `sgi:specchio`** (scheduler della Suite, ogni 6 ore: `SGI_SPECCHIO_MINUTES`, predefinito 360) e **Aggiorna adesso** in
  Impostazioni. Legge `/api/meta` e `/data/<chiave>.json` per docs, preparazioni, fulltext.
- **Confronto**: se cambia `meta.build` o lo sha256 (JSON canonico) di uno dei quattro JSON, la Suite sostituisce tutto in una transazione
  (`sgi.contenuti`, `sgi.stato`) e svuota la cache dei PDF. Validazione minima: `meta.build`, `docs` elenco, `preparazioni.righe` elenco,
  `fulltext` oggetto codice → testo. Il NUL dei testi estratti dai PDF si toglie (unica differenza dal sito).
- Errori dell'origine (rete, 4xx/5xx, JSON non valido, credenziali): lo specchio resta quello di prima, l'errore compare in Impostazioni e
  "Aggiorna adesso" risponde 424 con il motivo.
- **Primo avvio**: `afterStart` attiva il modulo (`startFresh`, schema `sgi`, LIVE) e, se lo specchio è vuoto, esegue subito il primo
  specchio in background. Se l'origine non risponde le pagine mostrano "Portale SGI da caricare" e chi gestisce rimedia da Impostazioni.

## Origine protetta (HTTP Basic)
Sul sito, `SGI_PASSWORD` (e `SGI_USER`, predefinito `sgi`) proteggono cruscotto, `/doc`, `/docs` e `/data`; `/api/meta`, `/preparazioni`,
`/p/`, `/m/` e `/stampabili/` restano aperti. La Suite manda `Authorization: Basic …` a ogni lettura (JSON e PDF) con:
1. `SGI_PORTAL_USER` / `SGI_PORTAL_PASSWORD` (variabili d'ambiente su Render: prevalgono, in app restano in sola lettura);
2. altrimenti utente e password salvati in SGI Management > Impostazioni > Credenziali dell'origine (`sgi.impostazioni`: `utente` in
   chiaro, `password` cifrata AES-256-GCM con `lib/secrets.js`, come le altre credenziali della Suite).
Utente vuoto = `sgi`, come il sito. Senza password nessuna intestazione. Con l'origine protetta e senza credenziali la lettura risponde
424 "L'origine è protetta da password (HTTP 401 su …/data/docs.json): imposta utente e password in SGI Management > Impostazioni (oppure
SGI_PORTAL_USER e SGI_PORTAL_PASSWORD su Render)"; con credenziali sbagliate "L'origine ha rifiutato utente e password". "Prova l'origine"
legge `/api/meta` (sempre aperta) **e** `/data/meta.json` (protetta), così verifica davvero le credenziali; prova anche utente e password
scritti nel modulo e non ancora salvati. La password non torna mai al browser (solo "impostata sì/no"), non compare nei log né nei
messaggi d'errore (solo URL e codice HTTP); il registro attività riporta "password impostata (utente …)" o "credenziali rimosse".
L'indirizzo dell'origine non può contenere credenziali (`https://utente:pw@…` è rifiutato).

## Cache dei PDF
I PDF di `docs/` (distribuzione e allegati) e `stampabili/` si scaricano **a richiesta** alla prima apertura e restano nell'archivio a due
vie del modulo (Azure Blob se configurato, altrimenti bytea) in `sgi.file_cache`. La Suite li serve da `GET /api/sgi/file/<percorso>`
(inline; `?dl=1` scarica) e dai link stabili; `X-SGI-Cache: HIT|MISS` dice se arrivano dalla cache o dal sito. Percorsi ammessi: solo
`docs/` e `stampabili/`, niente `..`, solo PDF; una risposta che non inizia con `%PDF-` non entra in cache. Ogni cambiamento dello
specchio svuota la cache; "Svuota cache" la azzera a mano.

## Fallback: ZIP del repository
Impostazioni > "ZIP del repository": GitHub, `td-sgi-portale` → Code → Download ZIP (circa 105 MB; limite `SGI_ZIP_MAX_MB`, predefinito
400). La Suite trova la radice (`td-sgi-portale-main/`), legge i quattro JSON da `data/`, **sostituisce sempre** lo specchio (fonte ZIP) e
mette in cache tutti i PDF (578 di `docs/` con gli allegati + 353 stampabili nella pubblicazione del 30/10/2026). I nomi `#Uxxxx` di alcuni
strumenti di estrazione (es. `1#U00b0 Trimestre`) tornano alla forma di `docs.json` (`1° Trimestre`).

## Le pagine (web/src/modules/sgi)
Filtri riscritti da `static/app.js` del sito in `web/src/modules/sgi/filtri.js` (funzioni pure, testate dal server).
- **Cruscotto documentale** (`/sgi`): i quattro riquadri-filtro (Documenti attivi; Procedure e istruzioni PRO+IDL; Moduli, informative,
  doc. esterni MOD+INF+DEX; Governo del sistema POL+MAN+PLN+REG+RPT; un secondo clic li disattiva), ricerca full-text (codice, titolo,
  sintesi, area, famiglia e testo integrale dei PDF: `fulltext.json` caricato alla prima ricerca, con ETag), area SGI, barra delle
  famiglie, **Azzera**; per ogni documento PDF, Stampabile, Allegati, busta (e-mail con i link pubblici, copiati anche negli appunti come
  collegamenti), copia del link stabile pubblico, link stabile interno. Senza filtri: Documenti cardine, le 18 aree (clic = filtro), Link
  stabili. `?q=` e `?area=` come sul sito; `?nontrovato=` per i link stabili inesistenti.
- **Ultime emissioni** (`/sgi/ultime`, 40 più recenti per data), **Documenti cardine** (`/sgi/cardine`, i 24 del sito nel loro ordine),
  **Versioni stampabili** (`/sgi/stampabili`): le scorciatoie della barra del sito, come viste del cruscotto (combinabili con ricerca e
  filtri).
- **Indice REG006** (`/sgi/indice`), **Mappa concettuale** (`/sgi/mappa`, MAN005), **Politica integrata** (`/sgi/politica`, POL001): sul
  sito aprono il PDF; la Mappa concettuale è un PDF (vista gerarchica, rete dei documenti cardine, ruota dell'integrazione), non un grafo
  HTML, quindi si porta dentro così com'è: visualizzatore a tutta altezza con codice, revisione, sintesi, link stabile, "Apri a schermo
  intero", "Scarica", e-mail e copia link.
- **Preparazioni agli esami** (`/sgi/preparazioni`): ricerca per codice o nome dell'esame, gruppo, preparazioni collegate, link per GIPO
  (pubblico, si copia con un clic) e link stabile interno `/sgi/p/<codice>`, tutte le istruzioni (INF in versione stampabile).
  `?codice=` come il sito, con l'avviso se il codice non è pubblicato.
- **Scrivi alla Qualità** (`/sgi/contatti`): qualita@toscanadiagnostica.it con l'oggetto del sito ("[Portale SGI] Richiesta") e un oggetto
  precompilato per segnalare un documento.
- **Impostazioni** (`/sgi/impostazioni`, EDITOR, Owner e Admin): origine, credenziali dell'origine, Prova l'origine, Aggiorna adesso,
  stato dello specchio con i conteggi confrontati con `meta.json` (documenti attivi, versioni stampabili, prestazioni), cache, ZIP,
  contenuti dello specchio.

## Collegamenti tra widget
Il Portale Service e il SGI condividono preparazioni e stampabili (stessi codici TD-SGI). Nel Portale Service, ogni documento che esiste
anche nello specchio SGI ha un'icona "Apri la scheda nel SGI Management" (`/sgi?q=<codice>`); l'elenco dei codici viene da
`GET /api/sgi/codici` (codici senza revisione, ETag). Se il widget SGI non è raggiungibile l'icona non compare.

## Accesso e profili
Modulo nativo (`kind NATIVE`, route `/sgi`, `open_to_all TRUE`): la migrazione core `038_sgi_nativo.sql` aggiorna la riga di produzione
(prima PUBLIC con `legacy_url`), senza toccare profili e grant. Tutti gli autenticati entrano come **LETTORE** (implicito; il profilo di
sistema Cliente service e i profili Default/Direzione hanno già sgi LETTORE); **EDITOR** (già proposto per l'area HQS/HSQ) e Owner/Admin
gestiscono Impostazioni, Aggiorna adesso, ZIP e cache; gli altri ricevono 403. Card della home con contatore "Documenti attivi"
(= `meta.n_docs`), visibile a chiunque veda il widget.

## API (`/api/sgi`, sessione della Suite)
| Metodo e percorso | Chi | Cosa |
| --- | --- | --- |
| GET `/state` | tutti | modo, ruolo, stato dello specchio, conteggi (n_docs, n_stampabili, n_prestazioni), origine |
| GET `/dati/:chiave` | tutti | meta, docs, preparazioni, fulltext (ETag = sha); 404 `SPECCHIO_VUOTO` se non ancora caricato |
| GET `/codici` | tutti | codici base dei documenti (per il Portale Service) |
| GET `/file/<percorso>` | tutti | PDF dalla cache, altrimenti dal sito (con le credenziali) e poi in cache |
| GET/PUT `/impostazioni` | EDITOR | origine (SGI_PORTAL_URL prevale), stato, credenziali (solo se impostate), cache |
| PUT `/impostazioni/credenziali` | EDITOR | `{utente, password}`: password assente = invariata, `null` o vuota = rimossa |
| POST `/impostazioni/prova` | EDITOR | prova origine e credenziali (anche non salvate: `{origine, utente, password}`) |
| POST `/aggiorna` (`{forza}`) | EDITOR | specchio adesso |
| POST `/zip` (multipart `file`) | EDITOR | importa lo ZIP del repository |
| POST `/cache/svuota` | EDITOR | svuota la cache dei PDF |
Link stabili (pagine, non API): `GET /sgi/doc/:codice`, `/sgi/m/:codice`, `/sgi/p/:codice` (senza sessione → login e ritorno; prestazione
con più preparazioni o sconosciuta → `/sgi/preparazioni?codice=…`; documento inesistente → `/sgi?nontrovato=…`).

## Cosa fare quando il sito cambia
**Niente.** La routine RSGI resta quella di oggi (`build\aggiorna_portale.bat`): entro 6 ore la Suite rileva la nuova build e svuota la
cache dei PDF; per vederlo subito, SGI Management > Impostazioni > Aggiorna adesso. Se un giorno si attiva `SGI_PASSWORD` su Render, vanno
impostate le stesse credenziali nella Suite (Impostazioni o `SGI_PORTAL_USER`/`SGI_PORTAL_PASSWORD`), altrimenti lo specchio si ferma
all'ultima pubblicazione letta con l'errore 424 visibile in Impostazioni. Una nuova pagina del sito o un nuovo JSON richiedono invece una
modifica della Suite.

## Patch del sito di origine (consegna separata)
Fuori da questo repository: solo `README.md` con la sezione "Copia conforme nella Suite" (la Suite specchia il sito, routine invariata).
Il sito non contiene voci verso le app di origine (nc., orders., circolari.) da rimappare: nessun altro file cambia.

## File
Server: `server/src/lib/specchioPortale.js` e `server/src/lib/specchioRegole.js` (comuni con il Portale Service);
`server/src/modules/sgi/` (`index.js` mount, link stabili, job, afterStart; `config.js`; `db.js`; `lib/regole.js`; `lib/specchio.js`
specchio e credenziali; `lib/invio.js`; `routes/sgi.js`; `migrations/001_init.sql`), core `migrations/038_sgi_nativo.sql`, `config.js`
(LEGACY_KEYS e FRESH_MODULES), `seed/modules.js`, `migrate.js` (etichetta della sorgente), `lib/legacy.js` (contatore). Web:
`web/src/modules/sgi/` (meta.js, index.jsx, dati.js, filtri.js, pages/, styles.css); `web/src/modules/service/` (rimando alla scheda SGI).
Test: `server/test/sgi-link.test.mjs`, `server/test/sgi-filtri.test.mjs`. Schermate: `docs/screens/sgi-{cruscotto,preparazioni,impostazioni}.png`.
