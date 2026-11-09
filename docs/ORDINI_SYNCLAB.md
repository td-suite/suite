# Ordini e Magazzino · fonte Synclab (v0.67.1)

Richieste del CEO dopo il primo completo Synclab in produzione (5.729 accettazioni, 1.634 esami, 115 clienti, 116 listini, 109
documenti). La copia è quella della Synclab Data API (schema `synclab` del core, proiezione standard: nessun dato del paziente);
Ordini la legge e basta. Codice: `server/src/modules/orders/lib/synclab.js`, `routes/synclab.js`, migrazione `014_synclab.sql`.

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
- Consumo medio mensile e verifica degli ordini usano la tabella `production` come prima: le righe Synclab entrano senza altre modifiche.

## 2. Correlazione esami e materiali (`/orders/correlazioni`)
- **Contenitori visti nel gestionale**: `orders.contenitori_synclab` (material, container, articolo_id, osservazioni, aggiornato_il), una
  riga per coppia vista nei campioni delle accettazioni attive (`synclab.samples`); "Aggiorna i contenitori" ricalcola le osservazioni e
  lascia gli abbinamenti. Ogni coppia si abbina a un articolo del catalogo (es. SIERO · PROVETTA → Tappo Giallo).
- **Coppia più frequente per esame**: dalle righe non cancellate legate ai campioni (`request_item_samples`): coppia, osservazioni,
  totale delle righe con un campione, percentuale. Colonna **"Dal gestionale"** nella tabella delle correlazioni, con il badge rosso
  "diverso" quando la coppia più frequente è abbinata a un articolo che l'esame non ha tra le sue correlazioni attive.
- **"Proponi correlazioni da Synclab"**: anteprima, poi conferma. Per gli esami la cui coppia più frequente è abbinata: NUOVA (nessuna
  correlazione) e CAMBIA (correlazione SYNCLAB verso un altro articolo) si applicano con `source = 'SYNCLAB'`, 1 unità per esame;
  INVARIATA e COINCIDE (una correlazione manuale ha già l'articolo) non cambiano nulla; CONFLITTO (correlazioni MANUALE o LISTINO verso
  altri articoli) **non si tocca** e resta da decidere a mano.
- `exam_mappings.source`: MANUALE (righe esistenti, inserite o importate), LISTINO, SYNCLAB. Il registro attività annota abbinamenti e
  proposte applicate.

## Verifiche in produzione
1. Produzione: "Aggiorna da Synclab", poi scegliere una sede e confrontare un mese con il gestionale; "client senza struttura" deve calare
   abbinando i client in Dati Synclab.
2. Correlazioni: "Aggiorna i contenitori", abbinare le coppie principali agli articoli, anteprima della proposta, leggere i conflitti
   prima di applicare.
3. Verifica di un ordine di una sede con produzione Synclab (consumo medio dei mesi impostati).

## Da decidere
- Se le correlazioni precaricate dal listino del 20/10/2026 vadano marcate LISTINO (oggi sono MANUALE, quindi protette).
- La quantità per esame proposta è sempre 1: per i contenitori condivisi da più esami nella stessa provetta il consumo reale è minore.
