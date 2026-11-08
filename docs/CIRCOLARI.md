# Modulo Circolari · registro, impaginazione, archivio, diffusione

Modulo nativo della Suite (chiave `circolari`, area Retail and Flow Management, accanto a Comunicazione). Si avvia vuoto da
Amministrazione > Travaso moduli > "Avvia il modulo" (è in `FRESH_MODULES`). Decisioni di Francesco Epifani del 24/10/2026:
format approvato (rev. del 24/10), protocollo `TD-AAAA/NNN` progressivo annuale unico per la rete, assegnato dal database alla
pubblicazione e mai in bozza, revisioni con suffisso `-r1`, `-r2` sullo stesso numero.

## Cosa fa
1. **Bozza.** Da file grezzo (DOCX, PDF, TXT, MD), da testo incollato o da scheda vuota (`POST /api/circolari/circolari/importa`,
   `POST /api/circolari/circolari`). Il testo viene estratto (`lib/extract.js`: paragrafi, elenchi, tabelle; le tabelle di
   impaginazione vengono sciolte) e strutturato con Claude (`lib/ai.js`, `askJson` di `lib/claude.js` della Suite) nella scheda:
   titolo, oggetto, destinatari, decorrenza, riferimenti, sintesi, tipo, linea, corpo a blocchi. Senza chiave Anthropic si usa
   l'euristica (`heuristicStructure`). Claude non deve alterare numeri, date, codici e condizioni; non riceve dati di pazienti.
2. **Rifinitura.** Pagina della bozza: scheda, editor dei blocchi (titolo di sezione, paragrafo, elenco, tabella), chiusura
   (contatti, firma, orientamento, segmento), "Ristruttura con Claude" sulla bozza di origine, "Anteprima impaginata"
   (`POST .../anteprima`: DOCX sempre, PDF con LibreOffice; senza protocollo, piè "Bozza non protocollata").
3. **Pubblicazione** (`POST .../pubblica`, profili ADMIN e PUBBLICATORE): in transazione, `pg_advisory_xact_lock` per anno,
   `numero = max + 1`, `protocollo = TD-AAAA/NNN`, `pub_token` casuale, impaginazione definitiva con QR code verso
   `BASE_URL/api/circolari/pub/<token>`, stato PUBBLICATA, voce `circolare_td` nell'indice di ricerca della Suite (`search_index`),
   audit `CIRCOLARE_PUBBLICATA`. Il testo non si modifica più.
4. **Revisione** (`POST .../revisione`): bozza che eredita tutto, stesso anno e numero, `parent_id`; alla pubblicazione prende
   `revisione = max + 1` e protocollo `TD-AAAA/NNN-rN`; le versioni precedenti passano a SUPERATA. Il canale pubblico del QR
   serve sempre l'ultima revisione PUBBLICATA dello stesso numero. **Annullamento** (`POST .../annulla`): stato ANNULLATA, resta
   in archivio con il protocollo; le bozze si eliminano (`DELETE`).
5. **Diffusione.** Liste di distribuzione (`/api/circolari/liste`, segmenti CLIENTI_SERVICE, PUNTI_PRELIEVO, MEDICINA_LAVORO,
   PERSONALE, PARTNER, ALTRO) con proposte dall'anagrafica unica (`public.sites` con email per tipo, `public.organizations`
   CLIENTE/PARTNER, `public.users` attivi). Invio (`POST .../invia`): `sendMail` della Suite (casella suite@), PDF allegato,
   collegamento alla versione digitale; esito per destinatario in `invii`.
6. **Archivio e ricerca** (`GET /api/circolari/circolari?q=`): full-text italiano sul contenuto (colonna generata `fts` su
   protocollo, titolo, oggetto, sintesi, destinatari, riferimenti, `corpo_testo`, testo della bozza di origine) con
   `websearch_to_tsquery`, estratti `ts_headline`, filtri per stato, anno, segmento. Le circolari pubblicate compaiono anche
   nella ricerca generale della Suite (kind `circolare_td`, audience della circolare, default INTERNAL).

## Impaginazione (`lib/render.js`, docx-js)
Carta intestata luglio 2026 (logo 232×73 px, contatti con icone, filo #71B1BD), fascia CIRCOLARE bicolore (#1C505E / #71B1BD) con
tipo e linea su due righe, "Protocollo n.", luogo e data; metadati con etichette centrate e valori giustificati; titolo 16 pt;
riquadro "In sintesi"; corpo giustificato, Titolo 2 numerati, elenchi con trattino azzurro; tabelle con intestazione #1B505F,
righe alternate #F4F6F8, celle centrate, prima colonna in grassetto, larghezze proporzionali al contenuto; box "Per informazioni"
con QR code 68 px; firma; piè "Circolare TD-AAAA/NNN - Pag. X di Y" più blocco societario. A4 verticale (utile 9638 twip) o
orizzontale (14570 twip): automatico (orizzontale se una tabella ha più di 5 colonne, `CIRCOLARI_LANDSCAPE_COLUMNS`) o forzato.
Nota tecnica: i paragrafi con immagini non devono avere interlinea impostata, altrimenti LibreOffice non le renderizza.
PDF con `soffice` (presente nell'immagine Docker; in locale può mancare: resta il DOCX e `render_error` lo dice). Assets in
`server/src/modules/circolari/assets/` (logo e icone della carta intestata).

## Schema `circolari`
`users` (riga tecnica del modulo), `circolari` (scheda, `corpo` JSONB, `corpo_testo`, `docx`/`pdf` BYTEA, `pub_token`, `fts`),
`liste`, `invii`, `letture` (solo conteggio delle aperture dal QR), `prese_visione` (dal 01/11/2026: presa visione per utente
della Suite, `POST /api/circolari/circolari/:id/presa-visione` sulle pubblicate del proprio perimetro; la legge "Il mio spazio" del Portale
Service, docs/SERVICE_PORTALE.md), `impostazioni`. Unicità `(anno, numero, revisione)`.

## Profili
ADMIN (tutto), PUBBLICATORE (pubblica, invia, revisiona, annulla, liste), REDATTORE (bozze, anteprime, ristrutturazione),
VIEWER (consultazione e download). Proposte di grant: area "retail & communications" → PUBBLICATORE, "laboratorio" → REDATTORE.

## Da fare
- (Fatto l'08/11/2026: le circolari di Comunicazione passano da questo registro, vedi "Circolari da Comunicazione".)
- BYTEA di DOCX e PDF nello schema del modulo: migrazione su Azure Blob nella fase 2, come per gli altri moduli.
- Tracciamento delle aperture per destinatario (oggi solo conteggio delle letture dal QR) e pagina pubblica HTML oltre al PDF.
- Collaudo della strutturazione con Claude in produzione (in locale la chiave non c'è: testato il ripiego euristico).

## Accesso aperto e perimetro di lettura (27/10/2026)
Richiesta del CEO: "a Circolari accede chiunque abbia un account, in rapporto alle liste di distribuzione: un cliente service
vede le circolari per il service, un punto prelievi quelle per i punti prelievo, un dipendente le vede tutte". Il modulo è
`open_to_all` (come Ticket): compare in home per tutti gli account e si entra senza grant con il ruolo implicito VIEWER.
Il perimetro lo calcola `server/src/modules/circolari/lib/visibilita.js` dall'anagrafica unica, a ogni richiesta:
- interno (persona DIPENDENTE, DIRIGENTE, LP, MEDICO o SANITARIO di una Legal entity GRUPPO/SOCIETA, oppure senza Legal
  entity; Owner e Admin della Suite): tutte le circolari di tutti i segmenti, tranne le bozze, che vede solo chi ha un grant
  di redazione (ADMIN, PUBBLICATORE, REDATTORE);
- esterno (persona ESTERNO o Legal entity CLIENTE, PARTNER, FORNITORE, TARGET, ALTRO): solo circolari PUBBLICATE dei suoi
  segmenti: sede di tipo SERVICE o Legal entity CLIENTE → Clienti service; sede PUNTO_PRELIEVI → Punti prelievo; Legal entity
  PARTNER → Partner; più i segmenti di ogni lista di distribuzione attiva in cui compare la sua email (Medicina del lavoro e
  Altro si raggiungono solo così: l'anagrafica non distingue un cliente di medicina del lavoro).
Il filtro vale per elenco, cruscotto, badge, dettaglio, PDF e DOCX; il cruscotto mostra all'esterno il suo perimetro. Le
regole di accesso (Amministrazione > Regole di accesso) restano solo per assegnare PUBBLICATORE e REDATTORE; nessun grant
serve per leggere. Nulla cambia per la versione pubblica da QR code (già senza sessione).

## Comunicazione: modifica dei contenuti pubblicati, formattazione, questionario (28/10/2026)
Segnalazioni del CEO: "quando aggiorno la news va in errore e non riprende il testo inserito"; "sull'elaboratore di testo aggiungi i tasti di
formattazione"; "quando inseriamo una circolare, con le API di Anthropic crea 3 domande a risposta multipla, registra gli esiti e falli vedere
solo a chi gestisce il widget".
- Causa dell'errore: la scheda di modifica non aveva una lettura singola del contenuto (ricadeva sull'elenco, che non porta il testo) e il
  pulsante richiamava la pubblicazione su un contenuto già pubblicato (rifiutata). Ora: `GET /api/community/manage/news/:id` restituisce il
  contenuto completo (testo, allegati, questionario); su un contenuto pubblicato il pulsante è "Aggiorna" e salva soltanto (resta pubblicato,
  nessuna nuova notifica); la pubblicazione di un contenuto già pubblicato aggiorna l'indice di ricerca e risponde `already_published`.
- Barra di formattazione Markdown sopra l'editor (grassetto, corsivo, titolo, sottotitolo, elenco puntato e numerato, citazione, link,
  separatore): agisce sulla selezione della textarea.
- Questionario di comprensione (migrazione 028): alla pubblicazione di una circolare `generateQuiz` (lib/claude.js) ricava dal testo tre
  domande a quattro opzioni; tabelle `news_quiz` e `news_quiz_answers`. I lettori ricevono le domande senza la risposta corretta
  (`GET /community/news/:slug` → `quiz`), rispondono una sola volta (`POST /community/news/:id/quiz`) e vedono punteggio e risposte corrette;
  con presa visione obbligatoria la conferma è possibile solo dopo aver risposto. Gli esiti (per domanda e per persona) escono solo in
  `GET /community/news/:id/acks` (chi pubblica) e nella pagina Presa visione, scheda Questionario. La redazione può rigenerare o rimuovere il
  questionario dalla scheda del contenuto (`POST/DELETE /manage/news/:id/quiz`). Senza chiave Anthropic la circolare si pubblica senza
  questionario e la risposta lo segnala (`quiz_error`).
- Dove si scrive: Blog da Gestione > Nuovo contenuto con Tipo = Blog (letto in Community > Blog); Bacheca dal riquadro in alto della pagina
  Bacheca (post liberi di tutti gli utenti); Avvisi da Gestione > Avvisi; presa visione con Tipo = Circolare, interruttore "Richiede presa visione".

## Segmenti dei partner (anagrafica unica, blocco 3, 08/11/2026)
Gli utenti esterni di una Legal entity che ospita un punto prelievi attivo (o firmataria di un contratto PP vigente) ricevono i segmenti
Punti prelievo e Partner anche se la Legal entity non è di tipo PARTNER; le proposte di destinatari di questi segmenti includono le
Legal entity ospitanti. Clienti service e Medicina del lavoro seguono i clienti attivi e contrattualizzati della Suite (blocco 2).

## Circolari da Comunicazione (08/11/2026)
Richiesta del CEO: "come mai se costruisco una circolare dal widget Comunicazione non figura anche in Archivio del widget Circolari? Deve!".
Regola: esiste UNA sola serie di circolari di Toscana Diagnostica, quella di questo modulo (registro TD-AAAA/NNN, carta intestata,
archivio, QR). Il codice del ponte è in `server/src/modules/circolari/lib/ponte.js`; i punti di aggancio sono in `server/src/routes/community.js`.

**Pubblicazione** (`POST /api/community/manage/news/:id/publish`, news `kind = CIRCOLARE`). Nella transazione della news, con un savepoint:
- con il modulo Circolari LIVE la circolare prende il prossimo numero del registro (`nextNumero`, stesso blocco consultivo per anno
  della pubblicazione nel modulo: le due strade condividono la serie), viene impaginata qui (DOCX e PDF su carta intestata, QR verso la
  versione digitale) ed entra in `circolari.circolari` come PUBBLICATA con `origine = 'COMUNICAZIONE'` e `news_id`; la news riceve
  `protocol = TD-AAAA/NNN` e `circolare_id`. Corrispondenze: titolo e sommario (In sintesi) della news; corpo Markdown convertito nei
  blocchi (`#`/`##` → titoli di sezione, paragrafi, elenchi puntati e numerati, citazioni, tabelle Markdown; immagini nel testo tolte;
  paragrafi lunghi divisi alle frasi, mai troncati); allegati della news agganciati (`circolari.allegati` e sezione "Allegati" nel corpo);
  destinatari = "Personale interno" o il perimetro scelto (sedi, Legal entity, modulo, utenti selezionati); decorrenza = data di
  pubblicazione; riferimenti = presa visione obbligatoria con la scadenza; tipo = INTERNA, linea vuota, segmento PERSONALE; "Per
  informazioni" e firma = autore della news (nome, email, ruolo dalla scheda persona).
- con il modulo non LIVE la news prende il protocollo provvisorio `CIRC-AAAA-NNN` come prima e l'esito lo dice ("protocollo provvisorio:
  avvia il modulo Circolari per il registro unico"); se il registro va in errore la pubblicazione non si blocca: errore nel log del
  server e nell'audit `NEWS_PUBLISHED`, protocollo provvisorio, avviso nell'esito. Un `CIRC-` non si riusa mai: `nextProtocol` conta
  anche `news.protocol_legacy`.
- notifica in app, email di avviso (con il **PDF protocollato allegato**), questionario e presa visione restano quelli di Comunicazione.
  La diffusione si registra in Circolari come invio al segmento PERSONALE (`circolari.invii` con `news_id`, una riga per news): gli
  esiti per destinatario si rileggono dal registro email della Suite (`email_log`, ref `news:<id>`), nessun secondo invio.

**Interfaccia.** Comunicazione, editor: con tipo Circolare la nota "Alla pubblicazione riceve il protocollo TD-AAAA/NNN del registro
Circolari ed entra nell'archivio" (o l'avviso del protocollo provvisorio se il modulo è spento); dopo la pubblicazione protocollo, "PDF
protocollato" e "Apri nell'archivio Circolari". Elenco dei contenuti: protocollo, "era CIRC-…", link PDF e archivio. Pagina della news:
"Scarica il PDF protocollato" (`GET /api/community/news/:id/pdf`, a chi vede la news) e, per il personale interno, "Apri nell'archivio
Circolari". Circolari, Archivio: colonna e filtro **Origine** (Circolari | Comunicazione); la riga di una circolare da Comunicazione
apre la news, con i link News, Presa visione e Scheda. Scheda: badge "da Comunicazione", riquadro con i link alla news e alla pagina
Presa visione, allegati; niente "Conferma presa visione", "Nuova revisione" e "Annulla" (si fanno in Comunicazione: le API rispondono 400).

**Revisioni.** Una circolare pubblicata in Comunicazione si aggiorna da chi può pubblicare ("Aggiorna"): se cambiano titolo, sommario,
testo, allegati o destinatari, l'aggiornamento registra in Circolari la revisione `TD-AAAA/NNN-rN` con il PDF nuovo (le precedenti passano
a SUPERATA, il QR serve l'ultima) e la news prende il nuovo protocollo; senza modifiche al contenuto (es. solo i tag) nessuna revisione;
nessuna nuova notifica. L'eliminazione definitiva della news (dopo l'archiviazione) porta la circolare collegata ad ANNULLATA: il
protocollo resta nel registro.

**Circolari già pubblicate con CIRC-** (es. la CIRC-2026-001 dell'08/11/2026). Amministrazione > Diagnostica, controllo **D42
"Circolari di Comunicazione fuori dal registro"** (circolari pubblicate senza `circolare_id`; "modulo non avviato" finché Circolari non è
avviato) con il pulsante **Registra**: prossimo numero TD-AAAA/NNN dell'anno di pubblicazione, `news.protocol` aggiornato e lo storico
in `news.protocol_legacy`, riga PUBBLICATA in Circolari con PDF, diffusione con gli esiti delle email già inviate; nessuna nuova notifica
né email. Idempotente (una seconda Registra non trova righe; unicità `(news_id, revisione)`). Notifiche e email già inviate citano il
vecchio protocollo: restano come sono.

**Dati.** Migrazioni idempotenti e non distruttive: core `050_circolari_ponte.sql` (`news.circolare_id`, chiave esterna logica verso
`circolari.circolari`, e `news.protocol_legacy`); modulo `003_comunicazione.sql` (`circolari.origine`, `news_id`, `allegati`,
indice unico `(news_id, revisione)`, `invii.news_id`, `invii.segmento`). Le circolari da Comunicazione non entrano nell'indice di ricerca
come `circolare_td` (ci sono già come news, con il protocollo TD): una sola voce.

**Verifiche in produzione dopo il rilascio.** 1) Modulo Circolari LIVE (Amministrazione > Travaso moduli). 2) Amministrazione >
Diagnostica: D42 mostra la CIRC-2026-001; "Registra" → TD-2026/NNN (il numero dipende da quante circolari sono già nel registro), PDF in
Archivio, "era CIRC-2026-001" nell'elenco. 3) Pagina della news: "Scarica il PDF protocollato" apre il PDF con il nuovo protocollo.
4) Prossima circolare da Comunicazione: protocollo TD nell'esito, riga in Archivio con origine Comunicazione, email di avviso con il PDF.
Nota: anche le circolari interne hanno il QR verso la versione digitale (URL con token casuale, come per tutte le circolari del registro).
