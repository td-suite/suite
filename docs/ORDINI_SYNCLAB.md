# Ordini e Magazzino · fonte Synclab (v0.67.1, etichette e pivot per articolo dalla v0.68.4)

Richieste del CEO dopo il primo completo Synclab in produzione (5.729 accettazioni, 1.634 esami, 115 clienti, 116 listini, 109
documenti). La copia è quella della Synclab Data API (schema `synclab` del core, proiezione standard: nessun dato del paziente);
Ordini la legge e basta. Codice: `server/src/modules/orders/lib/synclab.js`, `routes/synclab.js`, migrazioni `014_synclab.sql` e
`017_etichette_synclab.sql` (v0.68.4). Schermate (collaudo, dati sintetici): `screens/orders-produzione-pivot.png`,
`screens/orders-etichette.png`. Test: `server/test/synclab-nc-ordini.test.mjs`, `server/test/orders-etichette-pivot.test.mjs`.

## 1. Produzione StudioLab (`/orders/produzione`)
- **Fonte**: righe d'esame non cancellate (`request_items.deleted` falso o null) delle accettazioni ATTIVE, per mese (`requests.date`) e
  codice esame (`examCode`, senza spazi). Una riga = un esame.
- **Struttura**: dal client Synclab abbinato (`synclab.clients_td`, abbinamento confermato o proposto per codice StudioLAB):
  sede TD → id della sede; punto SERVICE → id del punto (la Legal entity lo somma, come fa già con HL7: `productionStrutture`);
  client abbinato solo a una Legal entity → −id. Client non abbinati: non contati (la pagina dice quanti sono).
- **Scrittura**: upsert in `orders.production` con `source = 'STUDIOLAB'` (lo stesso valore dei messaggi HL7). **La riga MANUALE o
  IMPORT dello stesso mese ed esame vince** e non si sovrascrive. Ogni aggiornamento ricalcola tutti i mesi presenti nella copia (dal
  primo a oggi, il mese in corso compreso) e toglie, per le strutture e i mesi ricalcolati, le righe STUDIOLAB che la copia non conferma
  più (esami cancellati); i mesi senza dati Synclab (per esempio HL7 di prima) restano come sono.
- **Quando**: job `orders:produzione-synclab` ogni 60 minuti (non all'avvio; solo modulo LIVE, `data_api_enabled` acceso e accettazioni
  nella copia) e pulsante **"Aggiorna da Synclab"**. Esito dell'ultimo aggiornamento in `orders.app_settings` (`synclab_produzione_ultimo`).
- **Pagina**: riquadro "La produzione arriva dalla copia Synclab del gestionale (ultimo aggiornamento …), dai messaggi HL7 e dai file
  importati" con la regola della riga manuale. Descrizione dell'esame dal catalogo `synclab.exams` quando c'è.
- **Vista principale (v0.68.4, richiesta del CEO del 10/11/2026): pivot per ARTICOLO di magazzino.** Scheda "Per articolo di
  magazzino": colonne = mesi con campioni (ultimi 6 più il mese in corso), una riga per articolo con la quantità = numero di CAMPIONI
  (provette e contenitori, `synclab.samples`) delle accettazioni ATTIVE dei client abbinati alla struttura con quell'etichetta nel mese
  (un campione = un contenitore consumato, anche quando serve più esami), totale, media mensile (totale / mesi con campioni) e confezioni
  al mese; sotto il nome le etichette che compongono la riga. Riga "Etichette non abbinate a un articolo" con il dettaglio per etichetta
  (apribile). Excel della pivot (`GET /api/orders/production/articoli.xlsx`). La scheda "Per esame" è la tabella di prima.
  Calcolo a richiesta sulla copia (`GET /api/orders/production/articoli`, `lib/synclab.js` `pivotArticoli`), nessuna tabella nuova:
  un abbinamento etichetta → articolo cambiato vale subito, senza aspettare il job orario; strutture come la produzione (sede, punto
  SERVICE sommato sulla sua Legal entity).
- **Consumo medio mensile e verifica degli ordini (v0.68.4)**: quando la struttura ha campioni nella copia Synclab (e la Data API è
  abilitata), gli articoli abbinati a un'etichetta si misurano dai CAMPIONI degli ultimi N mesi con campioni (N = mesi della verifica in
  Impostazioni) e non più da esami × correlazione, che sovrastima quando più esami condividono la provetta. Esami × correlazione resta
  per le strutture senza campioni e, nelle altre, per i soli articoli che nessuna etichetta rappresenta (materiale che un campione non
  misura, per esempio aghi). Ogni voce del consumo porta la fonte (campioni / esami × correlazione), visibile nella pagina Produzione.
- Punto di consegna (0.68.3): l'ordine di una Legal entity con più sedi service indica dove consegnare, ma la produzione resta sommata
  sulla Legal entity e la verifica dell'ordine la confronta con quella; produzione e giacenza per punto non sono gestite (decisione
  aperta, docs/SILVA_API_ORDINI.md sezione 2 bis).

## 2. Correlazione esami e materiali (`/orders/correlazioni`)
- **Etichette viste nel gestionale (v0.68.4, richiesta del CEO del 10/11/2026: "devo abbinare al prodotto in magazzino il TESTO
  DELL'ETICHETTA preso da StudioLab, non il materiale")**: `orders.etichette_synclab`, una riga per testo di etichetta distinto
  (chiave = testo senza spazi doppi, in maiuscolo: "T.Viola" e "T.VIOLA " sono la stessa etichetta; si mostra la scrittura più
  frequente). Fonte, nell'ordine: a) `synclab.samples.container` dei campioni delle accettazioni attive (il campo con cui la Data API
  espone contenitore/etichetta); b) se il connettore ServiceNET risponde, il testo delle etichette dell'esame in `Etichette[]` di
  `/api/esami` (IncludiEtichette), salvato da "Sincronizza catalogo esami" in `exam_catalog.label_text` (più etichette separate da " | "):
  entrano come righe "solo catalogo ServiceNET" con 0 campioni se il testo non compare nei campioni. Il materiale biologico (SIERO,
  PLASMA…) resta solo informativo (colonna "Materiale"), mai chiave. Colonne: testo dell'etichetta, campioni, esami che la usano
  (numero e primi codici), materiale, articolo di magazzino abbinato. "Aggiorna le etichette" ricalcola i campioni e lascia gli
  abbinamenti; le etichette non più viste tornano a 0 campioni.
- **Migrazione 017 (rifusione)**: le righe di `contenitori_synclab` (per coppia materiale/contenitore) si rifondono per etichetta
  (= contenitore); l'abbinamento si conserva; se più coppie con la stessa etichetta avevano articoli diversi si tiene quello con più
  osservazioni e la riga porta la segnalazione in rosso ("Rifusione 0.68.4: … tenuto il più osservato, da verificare"), che sparisce
  quando l'abbinamento si sceglie a mano. Idempotente: rieseguita non tocca le etichette già presenti. `contenitori_synclab` resta come
  storico e non si aggiorna più.
- **Etichetta più frequente per esame**: dalle righe non cancellate legate ai campioni (`request_item_samples`): etichetta, osservazioni,
  totale delle righe con un campione, percentuale; per gli esami senza campioni la prima etichetta del catalogo ServiceNET. Colonna
  **"Dal gestionale"** nella tabella delle correlazioni, con il badge rosso "diverso" quando l'etichetta più frequente è abbinata a un
  articolo che l'esame non ha tra le sue correlazioni attive.
- **"Proponi correlazioni da Synclab"**: anteprima, poi conferma. Per gli esami la cui etichetta più frequente è abbinata: NUOVA (nessuna
  correlazione) e CAMBIA (correlazione SYNCLAB verso un altro articolo) si applicano con `source = 'SYNCLAB'`, 1 unità per esame;
  INVARIATA e COINCIDE (una correlazione manuale ha già l'articolo) non cambiano nulla; CONFLITTO (correlazioni MANUALE o LISTINO verso
  altri articoli) **non si tocca** e resta da decidere a mano.
- `exam_mappings.source`: MANUALE (righe esistenti, inserite o importate), LISTINO, SYNCLAB. Il registro attività annota abbinamenti e
  proposte applicate.

## 3. Magazzino Centrale unico (v0.68.4)
"Catalogo articoli non è una sovrapposizione rispetto a Magazzino Centrale?" Sì: una sola voce di menu **Magazzino Centrale** con due
schede, **Giacenze Silva** (giacenze, lotti, visibilità dal feed Silva) e **Articoli ordinabili** (l'ex Catalogo articoli: visibilità,
confezione, categoria, codice Silva, etichetta del gestionale abbinata). "Catalogo articoli" non è più nel menu; `/orders/articoli`
rimanda a `/orders/magazzino?scheda=articoli`. Nelle giacenze ogni articolo ha "Ordinabile" sì/no (attivo, del catalogo Silva e
visibile ad almeno una tipologia; altrimenti il motivo) con il link alla sua riga negli Articoli ordinabili (`&articolo=<id>`).

## Verifiche in produzione
1. Correlazioni: "Aggiorna le etichette"; leggere le righe con la segnalazione della rifusione (articoli diversi sulla stessa
   etichetta) e confermare o cambiare l'articolo; abbinare le etichette principali (T.Viola, T.Giallo…); anteprima della proposta,
   leggere i conflitti prima di applicare. Se ServiceNET risponde: "Sincronizza catalogo esami" in Produzione e poi di nuovo "Aggiorna le
   etichette" (righe "solo catalogo ServiceNET").
2. Produzione: "Aggiorna da Synclab", scegliere una sede e confrontare un mese della pivot per articolo con le provette del gestionale
   (un campione con più esami deve contare una provetta); la riga delle etichette non abbinate deve calare abbinando; Excel.
3. Verifica di un ordine di una sede con campioni Synclab: il consumo medio delle provette deve risultare minore o uguale a quello di
   esami × correlazione (in Produzione la colonna "Fonte" dice da dove viene ogni articolo).
4. Magazzino Centrale: due schede, il vecchio indirizzo `/orders/articoli` apre "Articoli ordinabili"; "Ordinabile no" con il motivo.

## Da decidere
- Se le correlazioni precaricate dal listino del 20/10/2026 vadano marcate LISTINO (oggi sono MANUALE, quindi protette).
- La quantità per esame proposta è sempre 1: con la pivot per articolo dai campioni il consumo delle provette non dipende più da questa
  quantità; resta per gli articoli non rappresentati da un'etichetta e per le strutture senza campioni.
- Nomi dei campi di `Etichette[]` di ServiceNET: letti in modo difensivo (DescrizioneEtichetta, Descrizione, Etichetta, Testo): da
  confermare con CB Sistemi sulla prima risposta reale.
- Il mese in corso entra nella media del consumo come gli altri mesi (regola invariata dalla 0.67.1): a inizio mese abbassa la media.
