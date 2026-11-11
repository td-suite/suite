# Label · etichette provette e stampa Zebra (v0.69.0)

Modulo nativo della Suite: nome visibile **Label** (in Home, menu e titoli, deciso dal CEO), chiave tecnica `etichette`, area Retail and
Flow Management subito dopo il Business Hub, per sede (`scope_type` SITE), solo con grant. Richiesta del CEO del 10/11/2026 ("widget
davvero fondamentale"): dal numero di accettazione o dal cognome del paziente mostra in anteprima le etichette per provetta
dell'accettazione StudioLab e le stampa sulla stampante di etichette Zebra di cui sono dotate tutte le sedi.

Decisioni prese con il CEO:
- stampa via USB con **Zebra Browser Print** (programma locale di Zebra sul PC della sede), con ripiego **PDF**;
- ricerca per cognome con **identità conservata solo per gli ultimi giorni**;
- etichetta **uguale a quella di StudioLab**: il CEO manderà foto/PDF e misure del rotolo, quindi il disegno è un **modello configurabile**
  (ZPL con segnaposto); il predefinito "TD 50x25 (da validare)" è un default ragionevole, **da validare**.

Codice: `server/src/modules/etichette`, `web/src/modules/etichette`. Test: `server/test/etichette.test.mjs`. Schermate:
`docs/screens/etichette-stampa.png`, `etichette-modello.png`, `etichette-home.png`.

## Uso (operatore di sede)
Pagina **Stampa etichette** (`/etichette`):
1. Il campo di ricerca grande ha il fuoco all'apertura: si legge con il **lettore di barcode** il codice di una provetta (il lettore scrive
   il codice e preme Invio = cerca) o si scrive il **numero di accettazione**, oppure almeno 2 lettere del **cognome** (con la data
   facoltativa). Un solo risultato apre subito l'anteprima; più risultati: elenco con numero, data e ora, paziente, nascita, sede, provette.
2. Anteprima: **una etichetta per provetta** (campione), con gli esami di quella provetta, nome e nascita del paziente, contenitore e
   materiale, data e ora, numero dell'etichetta (1/4, 2/4...). Le etichette sono tutte selezionate: si toglie la spunta per stamparne solo
   alcune; copie da 1 a 20.
3. **Stampa tutte** (o **Ctrl+P**, che nel modulo sostituisce la stampa della pagina) invia lo ZPL alla Zebra; "Stampa selezionate" per
   una parte. In alto lo stato: **"Zebra pronta: <nome>"** oppure **"Browser Print non trovato: installa da zebra.com e riapri"** con la
   guida breve ("Come si fa"). Senza Browser Print il pulsante diventa **"Stampa tutte in PDF"**.
4. Ristampa: sempre possibile; la scheda dice "Già stampata n volte · ultima …" e nel registro la riga è marcata **ristampa**.
5. Un'accettazione senza nome del paziente (identità non disponibile) si stampa con l'avviso "le etichette escono senza nome: controlla in
   StudioLab".

La guida di 5 righe per l'operatore è in fondo alla pagina.

## Profili e perimetro
| Profilo | Cosa fa |
|---|---|
| **ADMIN** (Amministratore) | tutto: tutte le sedi, Modelli, Registro stampe, Impostazioni, stampa di prova. Owner e Admin della Suite senza grant entrano come ADMIN. La migrazione 001 del modulo dà il grant ADMIN ai titolari attivi all'avvio del modulo. |
| **OPERATORE** (Operatore di sede, con ambito) | cerca, anteprima, stampa e ristampa **per le sedi del proprio perimetro** (scope SITE del grant). Un operatore senza sedi nel grant non vede nessuna accettazione (niente perimetro implicito "tutte le sedi": sono dati dei pazienti). |

Perimetro di un'accettazione = sede della Suite abbinata al client Synclab (`synclab.clients_td.site_id`, confermata o proposta per codice
StudioLAB). Un client non abbinato a una sede è visibile solo all'ADMIN. Le accettazioni fuori perimetro non si mostrano: la ricerca dice
solo quante sono ("trovata ma fuori dal tuo perimetro di sedi"). Il modulo non è aperto a tutti: in Home la tessera la vede chi ha il grant
(e Owner/Admin). Nuovo profilo `OPERATORE` nella scala dei profili di accesso (`lib/accessProfiles.js`), accanto a OPERATOR.

## Fonte dei dati e ricerca
- **Copia Synclab** della Suite (`synclab.requests`, `request_items`, `samples`, `request_item_samples`, proiezione standard): numero,
  data e ora, client, stato, sesso della demografia, campioni con barcode, materiale e contenitore, righe d'esame e legami esame ↔ campione.
- **Numero di accettazione o barcode** (il testo contiene cifre): la stessa ricerca del Desk NC (`nc/lib/synclabDesk.js`
  `cercaAccettazioniSynclab`, riuso): esatta, normalizzata (senza spazi, trattini, barre, punti), anno + numero; su `request_number` e
  `samples.barcode`. Se nella copia non c'è: letture dirette già fatte; poi la **chiamata diretta al gestionale**
  `GET /api/v1/data/requests?requestNumber=…` e, se vuota, `?sampleBarcode=…` (confronto esatto, `includePatient=true`, `pageSize=5`),
  con il **202 della cattura** gestito con il polling sul cursor per al più 20 secondi (`ETICHETTE_ATTESA_DIRETTA_MS`), timeout di 15 s
  per richiesta: così si trova anche un'accettazione fatta due minuti fa, prima del delta di giorno. La risposta si salva in
  `etichette.accettazioni_dirette` **senza paziente** (testata, righe, campioni) e l'identità in `pazienti_recenti`; quando l'accettazione
  arriva nella copia, la copia prevale e la lettura diretta si cancella alla purga. `client.js` `pagina()` accetta ora `requestNumber` e
  `sampleBarcode` (solo requests) e un `timeoutMs`; i filtri non entrano mai negli ambiti del ciclo (`filtriCanonici` li ignora).
- **Cognome** (solo lettere, almeno 2; inizio del cognome, senza accenti e apostrofi; "cognome nome" filtra anche l'inizio del nome; data
  facoltativa): **solo sulle identità recenti** (`etichette.pazienti_recenti`), al più 50 risultati.
- Data API spenta (connettore StudioLAB non attivo, non `CLIENT_JWT` o `data_api_enabled` spento: stessa regola del recupero puntuale di NC,
  `dataApiAttiva`): nessuna chiamata al gestionale, la ricerca resta sulla copia e lo dice.

## Identità recenti: dati conservati e per quanto
| Dove | Cosa | Per quanto |
|---|---|---|
| `etichette.pazienti_recenti` | cognome, nome, data di nascita, sesso, numero e data dell'accettazione, quando è stata letta. **Codice fiscale mai** (colonna `cf` vincolata a NULL con un CHECK). Una riga vuota = "letta, il gestionale non ha restituito il paziente" (non si richiede di nuovo). | N giorni (impostazione `giorni_identita`, predefinito **7**, massimo **30**): purga quotidiana delle righe lette da più di N giorni o di accettazioni più vecchie di N giorni; riducendo N la purga è immediata. |
| `etichette.accettazioni_dirette` | accettazioni lette direttamente dal gestionale, **senza paziente** | come sopra, e cancellate appena l'accettazione è nella copia |
| `etichette.stampe` (registro) | chi, quando, sede, accettazione, numero di etichette, copie, stampante, metodo (ZEBRA, PDF, PROVA), esito, errore, ristampa | **nessun dato del paziente**; senza scadenza (registro) |
| `public.audit_log` | "Etichette stampate per l'accettazione X: n provette, sede, stampante" (o ristampate) | nessun nome |
| Copia `synclab.*` | invariata: la **proiezione paziente globale resta SPENTA** (`include_patient` del connettore non si legge né si tocca) | |

Come arrivano le identità: il job **`etichette:identita`** (ogni 15 minuti, lavora solo tra le **6 e le 22** ora di Roma, con il modulo LIVE
e la Data API accesa) prende le accettazioni **ATTIVE** degli ultimi N giorni dei **client abbinati a una sede** della Suite, senza
identità, dalla più recente, e per ciascuna chiama il dettaglio opt-in `GET /api/v1/data/requests/{id}?includePatient=true` **una alla
volta**, **al più 30 chiamate per giro** (dentro le 60 al minuto del contratto: il limitatore di `client.js` è comune a tutta la Suite);
dopo 3 errori consecutivi il giro si ferma. In più l'identità si legge **all'apertura** di un'accettazione che non ce l'ha (al più una
chiamata per accettazione ogni 2 minuti) e con la lettura diretta. Stato del job in `etichette.job_stato` (ultimo giro, ultimo giro
riuscito, esito, ultima purga), visibile in Impostazioni con "Aggiorna adesso". Nessun nome nei log: nel registro dei connettori il
percorso è `/api/v1/data/requests/{id}` senza query; l'esito del job ha solo conteggi.

## Etichette e modello
- Una etichetta per **campione** (`synclab.samples`) con gli esami **non cancellati** che lo usano (`request_item_samples`, o `sampleIds`
  della riga per le letture dirette), codici unici. Un campione legato solo a righe cancellate non si stampa (provetta non più necessaria);
  un campione senza righe collegate si stampa senza esami; un campione senza barcode esce senza codice a barre (avviso in anteprima).
- Etichetta **"richiesta"** facoltativa (impostazione `etichetta_richiesta`): senza barcode, con tutti gli esami, in fondo.
- **Modello** (`etichette.modelli`: nome, larghezza e altezza in mm, dpi 203 o 300, ZPL, attivo, predefinito, note, validazione).
  Segnaposto: `{BARCODE} {ACCETTAZIONE} {COGNOME} {NOME} {NASCITA} {SESSO} {DATA} {ORA} {CONTENITORE} {MATERIALE} {ESAMI} {CLIENTE}
  {SEDE} {N} {TOT}`; `{CAMPO:n}` tronca a n caratteri; senza `:n` valgono troncamenti predefiniti (COGNOME 22, NOME 18, ESAMI 60,
  CLIENTE e SEDE 32, ...). DATA e ORA = data e ora dell'accettazione; NASCITA gg/mm/aaaa; SESSO dall'identità o dalla demografia; ESAMI =
  codici d'esame della provetta; N/TOT = numero dell'etichetta sul totale dell'accettazione. I valori sono ripuliti (`^` e `~` non arrivano
  alla stampante) e i **campi rimasti vuoti si tolgono** (un `^BC` senza dati non si stampa).
- **Modello predefinito "TD 50x25 (da validare)"**: 50 × 25 mm a 203 dpi (400 × 200 dot): cognome e nome (troncati), "n. nascita sesso",
  "Acc. numero", Code 128 del barcode del campione (`^BY2`, alto 62 dot, testo in chiaro sotto, modo A automatico), contenitore e
  materiale, data e ora, N/TOT.
- **Modello per sede** (Impostazioni): senza scelta vale il predefinito.
- **Editor** (Modelli, ADMIN): misure, dpi, ZPL con i segnaposto da inserire con un clic, anteprima dal vivo con **dati di esempio
  inventati** (ESEMPIO ETICHETTA, barcode TD2600012345), anche a dimensione reale; segnala comandi non disegnati dall'anteprima,
  segnaposto sconosciuti, testi o codici che escono dall'etichetta, ^PW/^LL diversi dalle misure; "Stampa di prova" sulla Zebra del PC e
  "PDF di prova" (nel registro come PROVA).
- **Validazione**: finché nessun modello attivo è validato, il modulo mostra l'avviso fisso *"Modello non ancora validato: prima dell'uso
  sulle provette va confrontato con l'etichetta di StudioLab e letto dagli strumenti del laboratorio"* (Stampa etichette e Modelli) e la
  Diagnostica ha D54. "Segna come validato" chiede una nota (chi, confronto, lettura degli strumenti) e registra `validato_il`,
  `validato_da`; **cambiare ZPL, misure o dpi toglie la validazione**.

### Renderer ZPL (anteprima e PDF)
`lib/zpl.js`, codice puro **identico** in server e web (lo verifica il test): Code 128 con codifica automatica **B/C** e checksum
modulo 103 (modo N della Zebra con `>;` e `>:`), analisi dei comandi **^XA ^XZ ^FO ^FD ^FS ^A0 ^BC ^BY ^GB ^CI28 ^PW ^LL ^FB** (più ^LH,
^CF, ^FX commento, ^PQ), resa SVG in dot con le dimensioni in mm. I comandi non supportati si segnalano (la stampante li esegue,
l'anteprima no). Il carattere 0 della Zebra (CG Triumvirate Bold Condensed) è reso con un carattere condensato di sistema con la larghezza
**stimata** imposta (`textLength`): stesse proporzioni su ogni PC, ma non identico al pixel. Il testo ruotato (^A0R, ^BCR) si disegna
orizzontale con avviso. Nessun servizio esterno (niente Labelary).

## Stampa: Zebra Browser Print e PDF
`web/src/modules/etichette/lib/stampaZebra.js` (l'SDK JavaScript di Zebra non è incluso: tre chiamate fetch):
- rileva Browser Print provando **https://127.0.0.1:9101** e poi **http://127.0.0.1:9100**: `GET /available` (stampanti), `GET
  /default?type=printer` (predefinita);
- la stampante scelta si ricorda **per PC** (localStorage `td-etichette-stampante`: è una preferenza del dispositivo, non un dato);
- `POST /write` con `{ device, data }` e corpo `text/plain` (come l'SDK: niente preflight CORS); tutte le etichette e le copie in un solo
  invio (ogni etichetta ripetuta `copie` volte di seguito);
- errore di invio: riga ERRORE nel registro, messaggio "Riprova o usa PDF", nuova ricerca della stampante.
- **CSP**: `connect-src` della Suite include `https://127.0.0.1:9101` e `http://127.0.0.1:9100` (e fuori produzione l'indirizzo di
  collaudo `ETICHETTE_BROWSER_PRINT_URL`, mai in produzione).

**PDF di ripiego** (`lib/pdf.js`): una pagina delle dimensioni dell'etichetta per ogni etichetta e copia, con la stessa resa
dell'anteprima (SVG → immagine a 3× → jsPDF). Si stampa dal visualizzatore scegliendo la Zebra e **dimensioni effettive** (nessun
adattamento alla pagina). Va nel registro come PDF.

### Installazione di Browser Print in ogni sede
1. Scaricare **Zebra Browser Print** per Windows da zebra.com (Support > Software > Browser Print) e installarlo sul PC dell'accettazione;
   si avvia con Windows (icona nell'area di notifica).
2. Collegare la Zebra via USB con il suo driver; in Browser Print > Settings la stampante deve comparire come **Default Printer**.
3. **Certificato locale** (la Suite è in https, quindi Browser Print va raggiunto su https://127.0.0.1:9101): solo la prima volta aprire
   nel browser `https://127.0.0.1:9101/ssl_support` e accettare il certificato (Chrome/Edge: "Avanzate > Procedi").
4. **Host consentiti**: alla prima richiesta della Suite Browser Print mostra "Accept/Allow host suite.toscanadiagnostica.it?": rispondere
   **Sì** (resta in Settings > Accepted hosts).
5. **Accesso alla rete locale** (Chrome/Edge recenti: Private Network Access / Local Network Access): il browser può chiedere se il sito
   può accedere ai dispositivi della rete locale: **Consenti**. Browser Print risponde alla preflight con
   `Access-Control-Allow-Private-Network`. In alternativa http://127.0.0.1:9100 è ammesso dal browser anche da una pagina https perché
   l'indirizzo di loopback è considerato sicuro.
6. Aprire Label > Stampa etichette: deve comparire **"Zebra pronta: <nome>"**; con più stampanti si sceglie quella della postazione.
7. Prova: Label > Modelli > "Stampa di prova" (ADMIN) o una ristampa su un'accettazione di prova.

## Impostazioni (ADMIN)
`giorni_identita` (1-30, predefinito 7), `etichetta_richiesta` (spenta), modello per sede; stato della Data API, identità conservate e
letture dirette, ultimo giro e ultimo giro riuscito del job, "Aggiorna adesso". Registro stampe con filtri (date, esito, accettazione o
stampante), totale delle etichette stampate.

## Diagnostica
- **D54** "Etichette: nessun modello validato" (INFO): modelli attivi quando nessuno è validato.
- **D55** "Etichette: identità recenti ferme" (ATTENZIONE): con Label LIVE da oltre 2 ore e la Data API accesa (connettore StudioLAB
  abilitato, CLIENT_JWT, `data_api_enabled`), fra le 8 e le 22 ora di Roma, nessun giro riuscito del job da oltre 2 ore.

## API (`/api/etichette`, sessione della Suite)
| Metodo e percorso | Chi | Cosa |
|---|---|---|
| GET `/state` | tutti | profilo, sedi del perimetro, indirizzi di Browser Print, avviso di validazione, stato della Data API |
| GET `/cerca?q=&data=` | tutti | ricerca per numero/barcode (copia, letture dirette, gestionale) o cognome (identità recenti), nel perimetro |
| GET `/accettazioni/:istanza/:id` | tutti (perimetro) | accettazione, paziente (lettura puntuale se manca), modello, etichette con lo ZPL, stampe precedenti |
| POST `/stampe` | tutti (perimetro); PROVA solo ADMIN | registro della stampa o del tentativo, audit `ETICHETTE_STAMPA` / `ETICHETTE_PROVA` |
| GET/POST `/modelli`, PUT `/modelli/:id`, POST `/modelli/:id/predefinito`, POST/DELETE `/modelli/:id/valida` | ADMIN | modelli e validazione (audit `ETICHETTE_MODELLO`, `ETICHETTE_MODELLO_VALIDATO`) |
| GET/PUT `/impostazioni` | ADMIN | impostazioni e modello per sede (audit `ETICHETTE_IMPOSTAZIONI`) |
| GET `/identita`, POST `/identita/esegui` | ADMIN | stato e giro manuale del job (audit `ETICHETTE_IDENTITA`, solo conteggi) |
| GET `/registro` | ADMIN | registro delle stampe (100 per pagina) |

## Avvio in produzione
Label è in `FRESH_MODULES`: Amministrazione > Travaso moduli > **Avvia** (schema `etichette`, migrazione `001_init.sql` idempotente:
tabelle, modello predefinito, grant ADMIN ai titolari). Poi i grant OPERATORE con la sede (Amministrazione > Utenti o un profilo di
accesso con Label > Operatore di sede: l'ambito è la sede della persona).

### Verifiche in produzione dopo il rilascio
- `/api/health` → versione 0.69.0; in Home la tessera **Label** dopo Business Hub (per chi ha il grant e per Owner/Admin).
- Dopo "Avvia": `SELECT name FROM etichette.schema_migrations;` → `001_init.sql`; `SELECT nome, predefinito, validato_il FROM
  etichette.modelli;` → "TD 50x25 (da validare)", predefinito, non validato; `SELECT module_key, profile FROM grants WHERE module_key =
  'etichette';` → ADMIN al titolare.
- Data API accesa: Label > Impostazioni > "Aggiorna adesso" → letture e identità nuove; `SELECT count(*), count(cf) FROM
  etichette.pazienti_recenti;` → cf sempre 0; nel registro dei connettori solo `GET /api/v1/data/requests/{id}` senza query.
- `SELECT include_patient FROM synclab.sync_scope;` e l'impostazione `include_patient` del connettore: restano **false** (Label non le
  tocca).
- Ricerca con un numero di accettazione di oggi non ancora nella copia: fonte "dal gestionale" (lettura diretta) dopo qualche secondo.
- In una sede: Browser Print installato secondo la procedura, "Zebra pronta", stampa di prova del modello, confronto con l'etichetta di
  StudioLab, lettura del barcode con lo strumento del laboratorio e con il lettore dell'accettazione; poi "Segna come validato".
- Diagnostica: D54 finché il modello non è validato; D55 OK durante il giorno.

## Cosa NON si è potuto verificare senza una Zebra vera
- La stampa fisica: posizioni, dimensioni reali del carattere 0, qualità e leggibilità del Code 128 a 203/300 dpi, densità e velocità,
  allineamento al rotolo (gap/black mark, calibrazione), il comportamento con ^PW/^LL diversi dal rotolo montato.
- Il programma Browser Print vero: formato esatto delle risposte di `/available` e `/default` della versione installata, la richiesta di
  accettare l'host, il certificato su https://127.0.0.1:9101, il permesso di accesso alla rete locale nelle versioni di Chrome/Edge delle
  sedi, il driver USB. Il collaudo ha usato un finto Browser Print che riproduce le tre chiamate e registra lo ZPL ricevuto.
- La lettura del barcode stampato con gli strumenti del laboratorio (e la scelta B/C automatica della Zebra rispetto alla nostra:
  equivalente nei dati, larghezze possibili diverse di qualche modulo).
- Il PDF stampato su Zebra dal visualizzatore di Windows (scala "dimensioni effettive", margini del driver).
- Il disegno di StudioLab: atteso dal CEO (foto/PDF e misure del rotolo).

## Cosa chiedere a CB Sistemi (se serve il disegno originale)
- Il **file del modello di etichetta** di StudioLab (ZPL o EPL, o il formato del loro designer) con misure del rotolo, dpi delle stampanti,
  font e campi, così il modello della Suite lo riproduce uguale (copiando lo ZPL nell'editor e mettendo i segnaposto).
- La **simbologia e il formato del barcode** dei campioni (Code 128 sì/no, insieme, check digit, lunghezza, prefissi) e se gli
  strumenti del laboratorio leggono altro (es. barcode secondario, numero di accettazione).
- Le regole di StudioLab su **quante etichette** per campione o per accettazione (etichetta "richiesta", etichette aliquota) e sui testi
  abbreviati di esami e contenitori.
- Conferma che `requestNumber` e `sampleBarcode` della Data API sono confronti esatti sul valore stampato e tempi tipici del 202 per una
  ricerca puntuale.

## Collaudo e test
- `server/test/etichette.test.mjs`: Code 128 (casi noti con checksum: PJJ123C → 55, HI345678 → 68 con passaggio a C, 1234 → Start C 82,
  modo N, moduli), modello con segnaposto e troncamenti, campi vuoti tolti, analisi e avvisi del renderer, SVG, file condiviso identico,
  una etichetta per campione con gli esami giusti; con database: ricerca per numero (esatta, normalizzata) e barcode con il perimetro,
  Data API spenta senza chiamate, identità (30 chiamate per giro, solo client abbinati, attive e recenti, CF mai salvato e vincolato,
  nulla nella copia e nei log), purga, cognome (parziale, nome, data, perimetro), lettura diretta con 202 e polling (numero e barcode,
  salvata senza paziente), API (anteprima, 403 fuori perimetro, lettura puntuale all'apertura, stampa, ristampa, errore, registro e audit
  senza nomi), modelli (avvisi, validazione tolta al cambio del disegno, modello per sede, etichetta richiesta, purga riducendo i giorni),
  D54 e D55. Il server finto Synclab (`test/helpers/fakeSynclab.mjs`) ora applica i filtri `requestNumber` e `sampleBarcode`.
- Collaudo locale (11/11/2026) su database proprio, porta 3174, server finto Synclab e finto Browser Print: Home (tessera dopo Business
  Hub), ricerca da lettore di barcode con apertura diretta, stampa con Ctrl+P (4 etichette ZPL ricevute dal finto Browser Print), ristampa,
  ricerca per cognome, fuori perimetro, telefono senza scorrimento orizzontale, PDF di ripiego senza Browser Print (3 pagine 50 × 25 mm),
  Modelli, Registro, Impostazioni.

## Punti aperti
- Disegno definitivo e validazione del modello (foto/PDF e misure del rotolo dal CEO, prova in sede).
- Stampanti a 300 dpi: il modello predefinito è a 203 dpi; per una sede a 300 dpi serve un modello dedicato assegnato alla sede.
- Identità solo per i client abbinati a una sede: i client non abbinati si stampano cercando per numero o barcode (l'identità si legge
  all'apertura).
