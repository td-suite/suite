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
`liste`, `invii`, `letture` (solo conteggio delle aperture dal QR), `impostazioni`. Unicità `(anno, numero, revisione)`.

## Profili
ADMIN (tutto), PUBBLICATORE (pubblica, invia, revisiona, annulla, liste), REDATTORE (bozze, anteprime, ristrutturazione),
VIEWER (consultazione e download). Proposte di grant: area "retail & communications" → PUBBLICATORE, "laboratorio" → REDATTORE.

## Da fare
- Le circolari interne della Community (`news.kind = CIRCOLARE`, protocollo `CIRC-AAAA-NNN`, presa visione) restano un registro
  separato: da decidere se farle passare da questo modulo (protocollo unico) o tenerle come comunicazioni interne con presa visione.
- BYTEA di DOCX e PDF nello schema del modulo: migrazione su Azure Blob nella fase 2, come per gli altri moduli.
- Tracciamento delle aperture per destinatario (oggi solo conteggio delle letture dal QR) e pagina pubblica HTML oltre al PDF.
- Collaudo della strutturazione con Claude in produzione (in locale la chiave non c'è: testato il ripiego euristico).
