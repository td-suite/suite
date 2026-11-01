# Portale Service nella Suite · copia conforme del sito pubblico

Richiesta del CEO (01/11/2026): "In portale service: cambia la pagina Vademecum. Ingloba questa pagina:
https://referti.toscanadiagnostica.it/vademecum. Se non ce la fai, aprila in _blank. Inoltre, Circolari e aggiornamenti, apri il widget
Circolari. Ordine del materiale, apri il widget orders. Portale NC apri il widget NC." Poi: "inglobarlo e renderlo parte della suite. Ma
continuare ad aggiornare la app separata. Avere cioè copia conforme dei due sistemi. Che sia interna alla suite, che sia fuori. Questo per
eventuali necessità organizzative e di formazione, legate ai clienti."

## In breve
Una sola fonte, due presentazioni identiche. Il sito pubblico **service.toscanadiagnostica.it** (Flask, repo `td-service-portale`, Render)
resta la fonte dei contenuti e si aggiorna come oggi con la routine RSGI (`build\aggiorna_service.bat` → git push → Render). La Suite ne
tiene uno **specchio di sola lettura** e ne riscrive la presentazione in React (modulo `service`, widget HQS "Portale Service", route
`/service`): stesse sezioni, stessi testi, stessi dati. Nella Suite i contenuti non si modificano (nessun doppio inserimento): si gestiscono
solo origine, aggiornamento, cache e le quattro voci di menu rimappate.

| | Sito pubblico | Suite (`/service`) |
| --- | --- | --- |
| Chi lo vede | chiunque (decisione AD 13/10/2026) | ogni utente autenticato, clienti service esterni compresi (open_to_all) |
| Contenuti | `data/*.json` + PDF del repo | specchio dei JSON (`service.contenuti`) + PDF in cache (`service.file_cache`) |
| Link stabili | `/p/<shortcut>`, `/m/<codice>`, `/doc/<codice>` | `/service/p/…`, `/service/m/…`, `/service/doc/…` (stesse regole, PDF dalla cache) |
| Copia link / e-mail | link del sito | link **pubblici** del sito (chi li riceve, clienti e pazienti, non ha un account della Suite) |
| Vademecum | iframe del Vademecum online o PDF + pulsante (patch del sito) | iframe del Vademecum online o PDF dallo specchio + pulsante |
| Circolari / Ordine del materiale / Portale NC | link alla Suite (patch del sito, nuova scheda) | widget Circolari, Ordini e Magazzino, Non conformità |

## Lo specchio
- **Job `service:specchio`** (scheduler della Suite, ogni 6 ore: `SERVICE_SPECCHIO_MINUTES`, predefinito 360) e pulsante **Aggiorna adesso**
  in Impostazioni. Legge dall'origine `/api/meta` e `/data/<chiave>.json` per meta, docs, preparazioni, fulltext, certificazioni, veq,
  contatti, blog, menu.
- **Confronto** (`confrontaSpecchio`, `lib/regole.js`): se cambia `meta.build` o lo sha256 di uno dei JSON, la Suite salva tutto in una
  transazione (`service.contenuti`: chiave, json, sha256, bytes, fetched_at; `service.stato`: build, reg006_rev, reg006_data, fonte,
  ultima_lettura, ultimo_cambio, ultimi_motivi, ultimo_errore) e **svuota la cache dei PDF**. Lo sha è calcolato sul JSON canonico (chiavi
  ordinate): non dipende dalla formattazione, quindi è lo stesso che il JSON arrivi dal sito (`jsonify` di Flask ordina le chiavi) o dallo
  ZIP. Un file redazionale caricato sul repo via web senza rilanciare il batch (build invariata) viene comunque rilevato.
- Il carattere NUL (`\u0000`), presente nel testo estratto da qualche PDF in `fulltext.json`, non entra in un campo jsonb: viene tolto dalle
  stringhe (`senzaNul`). È l'unica differenza rispetto ai file del sito.
- Validazione minima (`validaContenuti`): `meta.build`, `docs` elenco, `preparazioni.righe` elenco, tutti e nove i JSON. Una pagina d'errore
  o un proxy non sostituiscono lo specchio.
- Errori dell'origine (rete, 4xx/5xx, JSON non valido): lo specchio resta quello di prima, l'errore compare in Impostazioni ("Ultimo
  errore") e "Aggiorna adesso" risponde 424 con il motivo.
- **Primo avvio**: il modulo non ha travaso. All'avvio del server (`afterStart`) si attiva da solo (`startFresh`, schema `service`, LIVE) e,
  se lo specchio è vuoto, esegue subito il primo specchio in background. Se l'origine non risponde le pagine mostrano "Portale Service da
  caricare" e chi gestisce il portale rimedia da Impostazioni (Aggiorna adesso o ZIP).

## Cache dei PDF
I PDF (`docs/`, `stampabili/`, `certificati/`, `vademecum/`) e i loghi PNG delle certificazioni (`static/`) si scaricano **a richiesta** dal
sito alla prima apertura e restano nell'archivio a due vie del modulo (`lib/moduleStorage.js`: Azure Blob se configurato, altrimenti
bytea) in `service.file_cache` (chiave = percorso sul sito, sha256, build di riferimento, fonte ORIGINE/ZIP, contatore di accessi). La Suite
li serve sotto il proprio dominio da `GET /api/service/file/<percorso>` (inline; `?dl=1` scarica) e dai link stabili; l'intestazione
`X-Service-Cache: HIT|MISS` dice se il file è arrivato dalla cache o dal sito. Percorsi ammessi: solo le cartelle elencate, niente `..`,
solo PDF (PNG/JPG per `static/`); una risposta del sito che non inizia con `%PDF-` non entra in cache. Più richieste contemporanee dello
stesso file ne scaricano una sola copia. Ogni cambiamento dello specchio svuota la cache; "Svuota cache" in Impostazioni la azzera a mano.

## Fallback: ZIP del repository
Impostazioni > "ZIP del repository": lo stesso ZIP che il CEO esporta da GitHub (Code → Download ZIP, circa 50 MB; limite
`SERVICE_ZIP_MAX_MB`, predefinito 200). La Suite trova la radice (la cartella che contiene `data/meta.json`, es.
`td-service-portale-main/`), legge i nove JSON da `data/` con la stessa pipeline dello specchio e **sostituisce sempre** lo specchio (fonte
ZIP), poi mette in cache tutti i PDF e i loghi dello ZIP. I nomi dei file vengono riportati alla forma di `docs.json` (NFC e sequenze
`#Uxxxx` di alcuni strumenti di compressione ridecodificate). Serve se il sito non risponde dalla rete di Render o per il primo
caricamento. Il successivo "Aggiorna adesso" riuscito torna alla fonte ORIGINE (e se i contenuti sono uguali la cache dello ZIP resta).

## Le pagine (web/src/modules/service)
- **Preparazioni e documenti** (home del widget): ricerca su prestazioni e documenti con evidenziazione, pillole, i quattro riquadri
  (prestazioni con preparazione, istruzioni per il paziente, moduli, procedure) che filtrano, elenco prestazioni con gruppo e link
  stabile, documentazione per area e tipologia con ricerca anche nel testo integrale dei PDF (`fulltext.json`, caricato alla prima
  ricerca, con ETag), istruzioni di preparazione per il paziente, documenti più richiesti (le scorciatoie della barra laterale del sito),
  "Link stabili e invio". `?codice=` e `?q=` come sul sito; `?nontrovato=` per i link stabili inesistenti.
- **Certificazioni**, **VEQ**, **Agorà** (elenco e articolo `/service/agora/<slug>`; newsletter: form Brevo in iframe se `brevo_url` c'è,
  altrimenti mailto a `fallback_email`), **Contatti**: stessi testi e dati delle pagine del sito.
- **Servizi** (`/service/servizi`, voci da `menu.json`) e **Vademecum** (sotto).
- **Impostazioni** (EDITOR, Owner e Admin della Suite).

## Le voci rimappate (menu Servizi)
Regola pura `mappaVoci` (`lib/regole.js`, test in `server/test/service-frame-menu.test.mjs`), endpoint `GET /api/service/servizi`:
- **Vademecum** → `/service/vademecum`, pagina interna (sotto).
- **Circolari e aggiornamenti operativi** → widget **Circolari** (`/circolari`).
- **Ordine del materiale** → widget **Ordini e Magazzino** (`/orders`); resta il modulo TD-SGI-MOD252 come alternativa.
- **Portale NC** → widget **Non conformità** (`/nc`).
- **Check-up e promozioni mensili** → segnaposto "in allestimento" come sul sito.
- Ogni altra voce con href verso la Suite (`suite.toscanadiagnostica.it/<modulo>`) o verso un'app TD già nella Suite (nc., orders.,
  circolari.) diventa il widget corrispondente; gli altri link restano esterni (nuova scheda).

Per ogni widget il server dice se l'utente lo vede (stesse regole della home: grant, modulo aperto a tutti, amministratori) e l'indirizzo
(`/<modulo>` se il modulo è dentro la Suite, `/go/<modulo>` altrimenti). Chi non vede il widget trova la voce con il motivo, il contatto
per l'abilitazione e l'alternativa (modulo cartaceo, riquadro del sito). **Accessi esterni**: il profilo di sistema Cliente service
comprendeva già Circolari (VIEWER) e Non conformità (SEDE) ma non Ordini; la migrazione core `037_service_nativo.sql` aggiunge
`orders` CLIENTE al profilo (solo se manca). Gli utenti esterni creati prima lo ricevono con "Applica profilo" (o ricreando l'accesso); il
grant nasce con le sedi della Legal entity, senza ambito se la Legal entity non ha sedi SERVICE collegate (avviso nel rapporto).

## Vademecum
`/service/vademecum` **incorpora** il Vademecum online (`SERVICE_VADEMECUM_URL`, predefinito https://referti.toscanadiagnostica.it/vademecum)
in un iframe a tutta altezza. Prima il server della Suite fa una richiesta di prova (`GET /api/service/vademecum/embeddabile`, timeout 8 s,
cache 1 ora; "Verifica di nuovo" per chi gestisce il portale) e legge `X-Frame-Options` e `Content-Security-Policy: frame-ancestors`
(`valutaIncorporamento`): frame-ancestors prevale su X-Frame-Options; DENY, SAMEORIGIN (origine diversa), `'none'`, `'self'` di un altro
sito o una sorgente che non comprende il dominio della Suite vietano; nessuna intestazione consente; una risposta non 2xx o un errore di
rete valgono come "non incorporabile". Se l'incorporamento è vietato o il sito non risponde la pagina mostra il motivo, il **PDF del
Vademecum dallo specchio** (`vademecum/…`: campo `pdf` della voce in `menu.json`, poi il PDF trovato nello ZIP, poi il nome storico) con
"Scarica il PDF" e "Apri il PDF a schermo intero", e il pulsante **"Apri il Vademecum online"** in una nuova scheda (target _blank).
La CSP della Suite ammette negli iframe `https://*.toscanadiagnostica.it`, `https://*.sibforms.com` (newsletter) e l'origine di
`SERVICE_VADEMECUM_URL`.

## Accesso e profili
Modulo nativo (`kind NATIVE`, route `/service`, `open_to_all TRUE`): la migrazione core 037 aggiorna la riga di produzione (prima PUBLIC con
`legacy_url`), senza toccare profili e grant. Tutti gli autenticati entrano come **LETTORE** (implicito); **EDITOR** (profilo già seminato,
proposto per l'area HQS) e Owner/Admin della Suite gestiscono Impostazioni, Aggiorna adesso, ZIP e cache. Card della home con contatore
"Documenti PDF pubblicati" (= `meta.n_pdf`), visibile a tutti perché il contenuto è pubblico.

## API (`/api/service`, sessione della Suite)
| Metodo e percorso | Chi | Cosa |
| --- | --- | --- |
| GET `/state` | tutti | modo, ruolo, stato dello specchio, conteggi (n_pdf, n_prestazioni), origine |
| GET `/dati/:chiave` | tutti | uno dei nove JSON (ETag = sha); 404 `SPECCHIO_VUOTO` se non ancora caricato |
| GET `/servizi` | tutti | voci del menu Servizi rimappate, con accessibilità dei widget |
| GET `/vademecum/embeddabile` | tutti | esito della verifica (cache 1 ora; `?rinnova=1` per EDITOR) e PDF di ripiego |
| GET `/file/<percorso>` | tutti | PDF o logo dalla cache, altrimenti dal sito e poi in cache |
| GET/PUT `/impostazioni`, POST `/impostazioni/prova` | EDITOR | origine (SERVICE_PORTAL_URL prevale), stato, cache; prova dell'origine |
| POST `/aggiorna` (`{forza}`) | EDITOR | specchio adesso |
| POST `/zip` (multipart `file`) | EDITOR | importa lo ZIP del repository |
| POST `/cache/svuota` | EDITOR | svuota la cache dei PDF |
Link stabili (pagine, non API): `GET /service/p/:codice`, `/service/m/:codice`, `/service/doc/:codice` (senza sessione → login e ritorno).

## Cosa fare quando il sito cambia
**Niente.** La routine RSGI resta quella di oggi: si rigenera e si pubblica il sito; entro 6 ore la Suite rileva la nuova build (o i JSON
cambiati), sostituisce lo specchio e svuota la cache dei PDF. Per vederlo subito: Portale Service > Impostazioni > Aggiorna adesso. Se un
giorno il sito non fosse raggiungibile dalla Suite: Impostazioni > ZIP del repository. Una nuova voce in `menu.json` compare da sola in
Servizi; una nuova sezione del sito (nuova pagina o nuovo JSON) richiede invece una modifica della Suite (nuova chiave in `CHIAVI` e nuova
pagina React).

## Patch del sito di origine (consegna separata)
Fuori da questo repository: `menu.json` (Circolari, Ordine del materiale, Portale NC → `https://suite.toscanadiagnostica.it/circolari`,
`/orders`, `/nc` in nuova scheda; campo `pdf` del Vademecum), pagina `/vademecum` (iframe del Vademecum online con lo stesso ripiego,
endpoint `/api/vademecum/embeddabile` in `app.py`), README con la sezione "Copia conforme nella Suite". Da applicare al repo
`td-service-portale` e pubblicare con la routine; lo specchio della Suite lo riprende da solo.

## File
Server: `server/src/modules/service/` (`index.js` mount, link stabili, job, afterStart; `config.js`; `db.js`; `lib/regole.js` regole pure;
`lib/specchio.js` specchio, ZIP, cache; `lib/invio.js`; `routes/service.js`; `migrations/001_init.sql`), core `migrations/037_service_nativo.sql`,
`config.js` (LEGACY_KEYS e FRESH_MODULES), `seed/modules.js`, `lib/legacy.js` (contatore), `index.js` (CSP frame-src). Web:
`web/src/modules/service/` (meta.js, index.jsx, dati.js, pages/, styles.css). Test: `server/test/service-link.test.mjs`,
`server/test/service-frame-menu.test.mjs`. Schermate: `docs/screens/service-{home,vademecum,servizi,impostazioni}.png`.
