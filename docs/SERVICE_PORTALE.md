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

## Il mio spazio (solo Clienti service, 01/11/2026)
Richiesta del CEO: "la terza mi piace molto! Ma va limitata esclusivamente ai clienti SERVICE e non ad altri (Legal Entity con tipo:
cliente)". Pagina del portale che riunisce, letti dai widget della Suite senza uscire dal portale, ciò che riguarda quel cliente; il
cliente apre il widget (scheda nuova) solo per agire.

**Chi la vede.** Solo l'accesso esterno **Cliente service** riconosciuto con certezza nel server (`clienteService` e la regola pura
`riconosciClienteService` in `server/src/lib/esterni.js`), tutte e quattro le condizioni: utente esterno (`isExternal`), Legal entity di
tipo CLIENTE, almeno un grant confermato nato dal profilo di sistema `CLIENTE_SERVICE`, almeno una sede SERVICE attiva della Legal entity
(il contratto service). Esclusi: Partner ospitanti (anche se la Legal entity è CLIENTE), CLIENTE senza punti SERVICE (anche con il profilo
applicato a mano), personale TD, Owner e Admin. Il front-end lo riceve come `cliente_service` in `/api/auth/me` e in `/api/service/state`.
- Menu (`meta.js`): voce "Il mio spazio" in cima, sopra Preparazioni e documenti (`when: cliente_service`); per tutti gli altri non esiste.
- Atterraggio: per il Cliente service `/service` è Il mio spazio; Preparazioni e documenti è `/service/preparazioni`. I link stabili e la
  ricerca (`/service?codice=`, `?nontrovato=`, `?q=`) aprono sempre Preparazioni e documenti. `/service/mio-spazio` per gli altri →
  home del portale.

**Cosa legge** (`GET /api/service/mio-spazio`, una risposta, `lib/mioSpazio.js`; regole pure in `lib/mioSpazioRegole.js`):
| Sezione | Contenuto | Perimetro (riusato dal modulo) | Link |
| --- | --- | --- | --- |
| Non conformità | NC aperte (APERTA, INVIATA_SEDE, RISPOSTA_SEDE, IN_TRATTAMENTO) comunicate e non annullate: numero, data, tipo, gravità, stato, sede, oltre termine; conteggi per stato | `perimetroSedi` (scope ORG = Legal entity; punti SERVICE → Legal entity) + `perimetroSedeSql` (nc/lib/access.js, lo stesso dell'elenco NC); solo profilo SEDE | `/nc/nc/:id`, `/nc/nc` |
| Ordini | ordini in corso: fasi 1-5 non concluse (`faseOrdine`: CHIUSO e ANNULLATO conclusi; per un CLIENTE anche CONSEGNATO): numero, data, fase, struttura; conteggi per fase | `strutturaDiUtente` (orders/lib/access.js, la stessa del middleware del modulo): la Legal entity; solo profili di struttura | `/orders/ordini/:id`, `/orders/ordini` |
| Circolari | ultime 10 pubblicate del segmento Clienti service con protocollo, titolo, data, presa visione sì/no; conteggio da leggere | `perimetro`/`filtro` di circolari/lib/visibilita.js + segmento CLIENTI_SERVICE | `/circolari/:id`, `/circolari/archivio` |
| Ticket | ticket aperti dall'utente non chiusi né annullati: numero, oggetto, stato, data; conteggio | `userContext`/`visibleSql` del modulo + richiedente = l'utente | `/ticket/:id`, `/ticket/miei` |
Per ogni sezione l'utente del modulo si costruisce con la stessa funzione e le stesse opzioni del modulo (`moduleUser` +
`OPZIONI_UTENTE` esportate da `nc`, `orders`, `circolari`, `ticket`); modulo non avviato o grant assente → `{ disponibile: false, motivo }`
(il riquadro KPI mostra "–", mai uno 0 inventato); una sezione in errore non fa cadere le altre. Cache per utente di 60 s (`?rinnova=1`,
pulsante "Aggiorna"). A chiunque non sia Cliente service: **404 "Non disponibile"**, nessun dato.

**Presa visione delle circolari.** Il modulo Circolari contava solo le aperture dal QR: dal 01/11/2026 ha la presa visione per utente
(`circolari/migrations/002_presa_visione.sql`, tabella `prese_visione`, `POST /api/circolari/circolari/:id/presa-visione`, solo
circolari PUBBLICATE del perimetro dell'utente, audit `CIRCOLARE_PRESA_VISIONE`; il dettaglio riporta `presa_visione_at`). Nel widget, sulla
circolare pubblicata, chi non è in redazione vede "Confermo la presa visione" o il badge con la data.

**Pagina** (`pages/MioSpazio.jsx`, classi del sito): fascia `.hero` con nome della Legal entity e pillole dei punti SERVICE; quattro
`.card.kpi` cliccabili (NC aperte, Ordini in corso, Circolari da leggere, Ticket aperti); quattro sezioni `.card` con tabella `.t` compatta,
badge di stato e, per sezione e per riga, "Apri in <widget>" / "Apri" (`target="_blank" rel="noopener"`); stato vuoto esplicito ("Nessuna
non conformità aperta.", "Nessun ordine in corso.", ...); widget non disponibile → avviso con il contatto service@.

**Isolamento** (requisito principale). Nessuna regola di accesso riscritta: solo i perimetri dei moduli, la Legal entity dal server, la cache
per id utente. Collaudo 01/11/2026 con due clienti reali (sotto): ciascuno vede solo i propri dati in tutte e quattro le sezioni; i dettagli
dell'altro nei widget restano 404/403.

## Home della Suite: i portali in una scheda nuova per il personale TD (01/11/2026)
Richiesta del CEO: "se uno clicca sul widget portale service dall'interno dell'azienda la apri in _blank e selezioni la pagina del service
che vuoi vedere! In modo da controllarne i contenuti." Per gli utenti **non esterni** la card Portale Service in Home apre `/service` in
una **scheda nuova**; il pulsante in alto a sinistra della card ("Apri pagina…") elenca le pagine del portale, ognuna in scheda nuova:
Preparazioni e documenti, Certificazioni, VEQ, Agorà, Tutti i servizi, Vademecum, Contatti, Impostazioni (solo EDITOR, Owner e Admin).
Le pagine vengono dal menu del modulo (`meta.js`, voci con `to`, filtrate come la barra laterale da `vociModulo` in
`web/src/modules/registry.js`; `paginaHome: false` esclude la voce, es. Check-up e promozioni, segnaposto). Il comportamento si attiva con
`homeSchedaNuova: true` nel `meta.js` del modulo. **Solo il Portale Service** lo ha: SGI Management resta dentro la Suite (il CEO non lo
ha mai chiesto per SGI; una prima versione lo aveva esteso per errore, corretto in v0.40.2). Per gli esterni la card si comporta come
prima (stessa scheda, nessun menu).

**Collaudo (01/11/2026, db dedicato `suite_spazio_t`, porta 3137, specchio da server statico).** Due CLIENTI con sedi SERVICE (Laboratorio
Alfa con due punti, Centro Beta con uno), un PARTNER con punto prelievi ospitato, un CLIENTE senza sedi SERVICE con profilo Cliente
service, una persona TD interna; accessi esterni creati dalla scheda Legal entity (`external-access`); NC, ordini, circolari (Clienti
service, Partner, bozza, superata), ticket per entrambi i clienti, per il partner, per la sede TD e per l'interno. API (42 verifiche): A vede
NC 0001-0003 (non la chiusa, l'annullata, quella non inviata, quella di Beta o della sede TD), ordini 0001-0004 con fase, circolari
001-003 con presa visione su 001 (2 da leggere), ticket 0001-0002, KPI 3/4/2/2, nessun nome o numero di Beta, cache alla seconda lettura;
B vede solo NC 0007, ordini 0007-0008, 3 circolari tutte da leggere, ticket 0004, nessun dato di Alfa; i dettagli di A nei widget per B
404/403; Partner, CLIENTE senza service, personale TD e titolare: 404 "Non disponibile" e `cliente_service = false`; modulo Ticket spento →
sezione `disponibile: false`, KPI "–". Playwright (25 verifiche): atterraggio di A su Il mio spazio, voce in cima, KPI, "Apri in Non
conformità" e "Apri" del ticket in scheda nuova (`context.on('page')`), Preparazioni su `/service/preparazioni`, card in Home dell'esterno
nella stessa scheda; B solo Centro Beta; Partner e interno senza voce e `/service/mio-spazio` → home del portale; Home dell'interno: card
Portale Service e SGI in scheda nuova, menu pagine, Certificazioni in scheda nuova, Impostazioni solo per il titolare. Schermate
`docs/screens/service-mio-spazio.png`, `docs/screens/home-card-portale.png`.

## Vista come Legal entity (personale TD, 01/11/2026)
Richiesta del CEO: "la versione deve essere sempre quella nuova; se ci clicca un utente di TD, fai scegliere con quale legal entity
visualizzare, altrimenti versione standard come Toscana Diagnostica S.r.l.; se clicca un cliente service, ha il suo portale."

**Selettore.** Per gli utenti non esterni il portale ha in alto una barra sottile (`pages/VistaCome.jsx`, classi del sito più `.vista-bar`
in `suite.css`): "Visualizza come: Toscana Diagnostica S.r.l. (standard) | <Legal entity…>" con ricerca per nome, codice e città.
L'elenco (`GET /api/service/clienti`, solo non esterni: id, nome, sedi SERVICE, accessi esterni; `elencoClientiService` in
`lib/esterni.js`) sono le Legal entity CLIENTE attive con almeno una sede SERVICE attiva, le stesse che il server riconosce come clienti
service (`legalEntityClienteService`). La scelta sta nel query string `?org=<id>` (link condivisibile tra colleghi) e in sessionStorage
(`vista.js`: resta mentre si naviga nel portale, solo in quella scheda); `?scegli=1` apre il selettore.
- **Con una Legal entity scelta**: "Il mio spazio" di quella Legal entity in cima al menu e come atterraggio su `/service` (Preparazioni e
  documenti passa a `/service/preparazioni`, come per il cliente), intestato con il nome della Legal entity e la dicitura "Vista del
  personale TD: come la vede il cliente"; la barra diventa color seta con "Torna alla versione standard". Il resto del portale è identico.
- **Senza scelta**: versione standard di oggi (Toscana Diagnostica S.r.l.), senza Il mio spazio.
- **Cliente service**: nessuna barra; ha il suo portale. Partner e altri esterni: nessuna barra, versione standard.

**Server.** `GET /api/service/mio-spazio?org_id=<id>`: il parametro vale solo per gli utenti non esterni (`orgRichiesta`); per gli esterni è
ignorato e vale la loro Legal entity (il cliente service vede solo la sua, il partner riceve 404). La Legal entity deve essere un cliente
service valido (`organizzazioneClienteService`), altrimenti 404 senza dati. `mioSpazioVista` (lib/mioSpazio.js) usa le stesse letture del
cliente parametrizzate sull'organizzazione: il cliente è "visto" dal modulo come un ambito ORG sulla Legal entity (`perimetroSedi`,
`strutturaDiUtente`), e ogni sezione rispetta i grant dell'utente TD (`sezioneVistaNegata`): senza il grant del widget la sezione è
`{ disponibile: false, motivo: 'widget non assegnato' }` (Ticket e Circolari, aperti a tutti, contano solo con un grant esplicito); Owner e
Admin vedono tutto. In più vale il perimetro dell'utente nel widget: profilo NC Sede → solo le sue sedi; profili Ordini di struttura → solo
la propria struttura; Ticket → `visibleSql` dell'utente (un responsabile vede solo i ticket delle sue caselle).
- NC e Ordini: gli stessi del cliente. Circolari: Clienti service pubblicate; la presa visione è il **conteggio dei lettori** tra gli accessi
  esterni della Legal entity ("1 su 2 accessi"), mai quella dell'utente TD; "da leggere" = circolari senza alcun lettore della Legal
  entity. Ticket: aperti (non chiusi né annullati) dagli accessi esterni della Legal entity, con il richiedente.
- Cache 60 s per utente e Legal entity. Audit leggero: ogni vista è registrata nel `read_log` (utente, modulo `service`, entity
  `mio_spazio_vista`, id della Legal entity), senza dati.

**Home.** La card Portale Service del personale TD apre la versione standard in scheda nuova; il menu "Apri pagina…" ha in cima
"Visualizza come Legal entity…" (`paginaHomeExtra` in `meta.js`) che apre `/service?scegli=1` in scheda nuova con il selettore aperto. La
card SGI Management non cambia.

**Collaudo (01/11/2026, db `suite_spazio2_t`, porta 3138, specchio su 7050).** Stessi dati del collaudo di Il mio spazio più un utente TD con
il solo grant Circolari. API (29 verifiche, più le 42 del collaudo precedente ripetute): elenco clienti service = Alfa e Beta (non Partner, non
il CLIENTE senza sedi SERVICE); il titolare senza `org_id` 404, come Alfa vede NC 0001-0003, ordini 0001-0004, circolari con "1 su 1" lettori
su 001 e 2 senza lettori, ticket di Anna con il richiedente, niente di Beta; come Beta solo i dati di Beta (la presa visione di Anna non conta);
`org_id` di Partner, CLIENTE senza service, inesistente → 404; `read_log` con le viste di Alfa e Beta e nessuna per le rifiutate; utente con
solo Circolari: Circolari leggibile, NC/Ordini/Ticket "widget non assegnato", KPI –/–/2/–; utente Ticket RESPONSABILE senza caselle: 0
ticket; Anna con `?org_id=Beta` vede Alfa, Bruno con `?org_id=Alfa` vede Beta, `/service/clienti` 404 per gli esterni, il partner 404.
Playwright (23 verifiche): barra standard, ricerca e scelta di Alfa (`?org=1`), intestazione, voce in cima, KPI, lettori; la vista resta
navigando; cambio su Beta; ritorno allo standard; link `?org=1` aperto da un collega; utente con solo Circolari; cliente senza barra e
`?org` ignorato; Home: clic sulla card → standard in scheda nuova, prima voce del menu "Visualizza come Legal entity…" → selettore aperto in
scheda nuova. Schermata `docs/screens/service-vista-come.png`.

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
`lib/specchio.js` parametri dello specchio, conteggi, Vademecum; dal 01/11/2026 la meccanica comune con SGI Management è in
`server/src/lib/specchioPortale.js` e `server/src/lib/specchioRegole.js`, docs/SGI_PORTALE.md; `lib/invio.js`; `routes/service.js`; `migrations/001_init.sql`), core `migrations/037_service_nativo.sql`,
`config.js` (LEGACY_KEYS e FRESH_MODULES), `seed/modules.js`, `lib/legacy.js` (contatore), `index.js` (CSP frame-src). Web:
`web/src/modules/service/` (meta.js, index.jsx, dati.js, pages/, styles.css). Il mio spazio: `server/src/modules/service/lib/{mioSpazio,mioSpazioRegole}.js`, `lib/esterni.js`
(`clienteService`), `routes/auth.js` (`cliente_service`), `modules/{nc,orders,circolari,ticket}/index.js` (`OPZIONI_UTENTE`), `nc/lib/access.js`
(`perimetroSedeSql`), `orders/lib/access.js` (`strutturaDiUtente`), `circolari/migrations/002_presa_visione.sql`, `circolari/routes/circolari.js`;
web `modules/service/pages/{MioSpazio,VistaCome}.jsx`, `modules/service/vista.js`, `modules/registry.js` (`vociModulo`), `components/{Widget,Shell}.jsx`, `styles.css` (`.widget-pages`),
`modules/circolari/pages/Circolare.jsx`, `modules/sgi/meta.js`. Test: `server/test/service-link.test.mjs`,
`server/test/service-frame-menu.test.mjs`, `server/test/service-mio-spazio.test.mjs`. Schermate: `docs/screens/service-{home,vademecum,servizi,impostazioni,mio-spazio,vista-come}.png`, `docs/screens/home-card-portale.png`.
