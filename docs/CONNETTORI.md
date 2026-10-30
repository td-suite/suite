# Connettori unici verso i sistemi esterni

Decisione del CEO (26/10/2026): i dati di accesso ai sistemi esterni (StudioLAB ServiceNET di CB Sistemi, GIPO, TuoTempo, Silva)
esistono una volta sola, in Amministrazione > Connettori, e valgono per tutta la Suite. Nessun modulo tiene più chiavi, base URL
o segreti propri: Non conformità, Ordini e Magazzino e Retail leggono dal connettore unico. Le pagine Impostazioni dei moduli
mostrano solo lo stato e il link "Configura in Amministrazione > Connettori".

## Dove stanno i dati
- Tabella `public.connectors` (migrazione core 025): una riga per sistema, `kind` tra STUDIOLAB, GIPO, TUOTEMPO, SILVA. Colonne:
  `name`, `enabled`, `base_url`, `auth_kind` (API_KEY, BASIC, OAUTH2, NONE), `credentials` (JSON cifrato: api_key, oppure user e
  password, oppure client_id e client_secret), `inbound_secret` (cifrato: il segreto con cui il sistema esterno chiama la Suite),
  `settings` (JSONB: client_code, instance, lang, timeout_ms, ip_allowlist, customer_code, order_email), `schedule`, esito
  dell'ultimo test (`last_test_at`, `last_status`, `last_message`), `updated_at`, `updated_by`.
- Cifratura con `lib/secrets.js` (AES-256-GCM, chiave `CREDENTIALS_KEY` di Render; in sua assenza quella derivata da
  `SESSION_SECRET`). Le credenziali non si rileggono mai in chiaro: l'interfaccia mostra "impostata" e gli ultimi 4 caratteri.
- Registro `public.connector_log`: ogni chiamata in ingresso (IN, il fornitore chiama la Suite) e in uscita (OUT, la Suite chiama
  il fornitore) con modulo, endpoint, esito, millisecondi e messaggio. Le ultime 50 compaiono nella card del connettore.
- Lib `server/src/lib/connectors.js`: `getConnector(kind)` (asincrona) e `connectorSync(kind)` (dalla cache in memoria, usata dai
  getter delle configurazioni dei moduli) restituiscono base URL, impostazioni, credenziali e segreto in chiaro; `verifyInbound(kind,
  segreto)` confronta a tempo costante; `inboundConfigured(kind)`; `logConnector({...})`; `testConnector(kind)`;
  `studiolabRoot(baseUrl)` toglie il suffisso `/API` per le chiamate REST (`/api/whoami`, `/api/esami`, `/api/accettazioni`).
  La cache si aggiorna a ogni salvataggio dall'Amministrazione (`saveConnector` → `refreshConnector`).
- Ripiego: finché la riga non ha credenziali né segreto (`configured = false`) valgono le variabili d'ambiente storiche dei moduli:
  STUDIOLAB → `LIS_API_KEY` o `STUDIOLAB_API_KEY`, `LIS_BASE_URL` o `STUDIOLAB_API_URL`, `LIS_PUSH_SECRET` e `STUDIOLAB_INBOUND_KEY`
  (entrambi accettati in ingresso), `LIS_CODICE_CLIENTE`, `LIS_TIMEOUT_MS`; SILVA → `SILVA_INBOUND_KEY`, `SILVA_CUSTOMER_CODE`,
  `SILVA_ORDER_EMAIL`. La card segnala "Variabili d'ambiente" quando il ripiego è in uso. Appena si salvano credenziali o segreto
  nella Suite, le variabili non contano più per quel sistema (anche se il connettore viene poi disabilitato).

## API (solo ADMIN e OWNER, `routes/connectors.js`, montate su /api/connectors)
- `GET /api/connectors` elenco con stato (configured, enabled, active, source db/env/none, credenziali mascherate, segreto in ingresso
  mascherato, ultimo test, endpoint da comunicare al fornitore).
- `PUT /api/connectors/:kind` {enabled?, base_url?, auth_kind?, schedule?, settings?, credentials? (oggetto: solo le chiavi
  valorizzate sostituiscono; `null` rimuove tutto), inbound_secret? (stringa di almeno 16 caratteri; `null` rimuove)}.
- `POST /api/connectors/:kind/test` prova leggera: StudioLAB `GET /api/whoami`, TuoTempo `GET /{instance}/typologies`, Silva e GIPO
  solo validazione. Risponde sempre 200 con `{ok, message, ms}`; l'esito resta sulla riga e nel registro.
- `POST /api/connectors/:kind/rotate-inbound` genera un segreto casuale (32 caratteri), lo salva cifrato e lo mostra una sola volta.
- `GET /api/connectors/:kind/log?limit=50` ultime chiamate.
- Audit Suite: CONNECTOR_UPDATED, CONNECTOR_TESTED, CONNECTOR_INBOUND_ROTATED.

## Cosa configura l'amministratore
1. StudioLAB: base URL (predefinita `https://servicenet.toscanadiagnostica.it/API`), chiave API (header X-API-KEY) fornita da CB
   Sistemi, codice cliente (CodiceCliente, di norma TD), timeout, segreto in ingresso ("Rigenera" oppure un valore concordato),
   IP consentiti (informativi), interruttore Abilitato. Prova connessione.
2. TuoTempo: base URL (`https://app.tuotempo.com/api/v3`), api_key dell'istanza, istanza (dbName), lingua. Prova connessione
   (typologies, nel perimetro Key Entities).
3. GIPO: nessuna API documentata; eventuale base URL e chiave quando Docplanner le fornirà. I dati entrano con l'import da file di
   Retail e con le API di ingestione (`/api/ingest/*`, chiave in Amministrazione > Chiavi API).
4. Silva: segreto in ingresso, codice cliente presso Silva, email ordini di ripiego. Nessuna chiamata in uscita.

## Cosa deve fare CB Sistemi (StudioLAB)
- Chiamare gli endpoint della Suite con l'header `X-API-KEY` (per Non conformità va bene anche `X-Push-Secret`) uguale al segreto
  in ingresso del connettore StudioLAB, comunicato dall'amministratore dopo "Rigenera":
  - `POST <BASE_URL>/api/nc/hl7` messaggi HL7 v2.5 (OML^O21, ORL^O22, MDM^T02/T10, ADT) in `text/plain`; risposta ACK, HTTP 200
    sempre (esito nel segmento MSA); 401 se il segreto non è valido, 503 se il canale non è configurato.
  - `POST <BASE_URL>/api/nc/lis/push` NotificaPush JSON `{IdAccettazione, TipoNotifica, IdDocumento}`.
  - `POST <BASE_URL>/api/orders/integrations/studiolab/hl7` messaggi HL7 di accettazione per la produzione per cliente; risposta ACK.
  - `<BASE_URL>` è l'indirizzo pubblico della Suite (`https://suite.toscanadiagnostica.it`); gli URL completi sono nella card.
- Fornire a Toscana Diagnostica la chiave X-API-KEY per le chiamate REST in uscita (whoami, esami, accettazioni, segnalazioni) e
  confermare il CodiceCliente. Le chiamate in uscita partono dagli IP statici in uscita del servizio Render della Suite: se CB
  Sistemi filtra per IP, vanno autorizzati quelli.
- Gli IP da cui StudioLAB chiama la Suite si annotano in "IP consentiti" (per il firewall; la Suite verifica il segreto, non l'IP).

## Cosa deve fare Silva
- Interrogare ogni 5 minuti `GET <BASE_URL>/api/orders/integrations/silva/orders` e inviare feed e avanzamenti su
  `/api/orders/integrations/silva/stock` e `/api/orders/integrations/silva/orders/:numero/(presa-in-carico|spedito|consegnato)`,
  sempre con l'header `X-API-KEY` uguale al segreto in ingresso del connettore Silva. `GET .../silva/ping` verifica la chiave.

## Moduli
- Non conformità: `config.lis` (baseUrl, apiKey, codiceCliente, pushSecret, timeoutMs) sono getter sul connettore STUDIOLAB;
  `routes/inbound.js` verifica con `verifyInbound`; `lib/lis.js` registra le chiamate in uscita.
- Ordini: `config.studiolab` e `config.silva` sono getter sui connettori STUDIOLAB e SILVA; `routes/integrations.js` verifica con
  `verifyInbound` e registra ogni chiamata del fornitore; `lib/studiolab.js` registra le chiamate in uscita.
- Retail: la pagina Connettori del modulo resta per le sincronizzazioni (pianificazione, giorni, esiti, import da file); credenziali,
  base URL e istanza vengono dal connettore core (`getConnector('TUOTEMPO')` in `lib/connectors.js` del modulo). La migrazione
  007 aggiunge `core_migrated_at` e sema le tre righe del modulo; all'avvio (`afterStart` in index.js) le credenziali salvate
  dall'app di origine in `retail.connectors` vengono copiate una volta nel core, ricifrate con `lib/secrets`, se il core è vuoto.

## Collaudo (26/10/2026)
Server locale su :3109. `PUT STUDIOLAB` con chiave e segreto → rilettura mascherata (••••1234, ••••6789); `rotate-inbound` → il
segreto vecchio è rifiutato (401) su `/api/nc/hl7` e `/api/orders/integrations/studiolab/hl7`, quello nuovo accettato (ACK);
`/api/nc/lis/push` con segreto nuovo accettato (202 perché StudioLAB non è raggiungibile dal sandbox); Silva: 503 senza segreto,
401 con segreto errato, ping e feed OK con il segreto del connettore; prova connessione StudioLAB e TuoTempo fallisce con
"non raggiungibile: getaddrinfo ENOTFOUND" (registrato, nessun 500), Silva e GIPO "configurazione valida"; registro popolato
(IN e OUT); ripiego ambiente: con connettore non configurato e `LIS_PUSH_SECRET` nell'ambiente il push e l'HL7 passano ancora.
Playwright su /admin/connectors, /nc/impostazioni, /orders/impostazioni, /retail/connettori senza errori di console né 500
(screenshot `docs/screens/admin-connectors.png`).

## Silva: API catalogo v1 in lettura (30/10/2026)
Silva ha attivato `https://silva.cloud/portaleordini` con header `X-API-KEY` (chiave inserita a mano in Amministrazione > Connettori > Silva, validità 365 giorni: la scadenza si annota in "Scadenza della chiave" e Magazzino avvisa 30 giorni prima). Chiamate: `GET /api/v1/catalogo?anno=` (fotografia completa; l'header `X-Catalog-Updated-At` è il riferimento) e `GET /api/v1/catalogo/modifiche?anno=&dal=` (nuovi/modificati, anche sola giacenza, più `eliminati`; nuovo riferimento in `aggiornatoAl`). La Suite (server/src/modules/orders/lib/silvaCatalog.js) tiene un riferimento per anno in `connectors.settings.cursors`, lo aggiorna solo dopo l'importazione riuscita, riparte dal completo su `409 full_sync_required`, legge gli anni di "Anni contabili da leggere" (default anno corrente) ogni "Intervallo di lettura" minuti (job `orders:silva-catalogo`, default 60) e su richiesta da Ordini > Magazzino ("Leggi da Silva", "Catalogo completo"). Le giacenze entrano in `warehouse_stock` come il feed in ingresso (gli eliminati vanno a zero); lotti, scadenze e GTIN arrivano vuoti in questa versione. "Prova" del connettore legge il catalogo dell'anno e riporta articoli e data. Il canale in ingresso (segreto X-API-KEY di Silva verso le API Ordini) resta per ordini e avanzamenti.
