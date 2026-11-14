# Pulizia allegati (Amministrazione, solo titolare)

Dalla v0.73.0. La pulizia del 07/11/2026 (migrazione business 017) aveva tolto i riferimenti alla gestione precedente dai **campi di
testo** (termini di pagamento, note, diario), non dai **file allegati**: i nomi dei file e il loro contenuto erano rimasti. Questo
strumento chiude il buco.

- Dove: Amministrazione > Controllo > **Pulizia allegati** (`/admin/pulizia-allegati`), riservata al titolare della Suite.
- Cosa controlla: allegati dei contratti del Business Hub (`business.contract_files`), documenti dei fascicoli di autorizzazione
  (`business.dossier_files`), documenti degli account (`business.documenti`), documenti dei professionisti di Room Planning
  (`room.professionista_docs`), documenti delle sedi (`public.site_documents`).
- Come cerca: termini separati da virgola (predefiniti `Fanfani, Synlab`), nel **nome** del file e nell'etichetta, e nel **contenuto**:
  docx/xlsx/pptx dal loro XML, PDF con pdftotext, firmati `.p7m` dal PDF incapsulato quando leggibile, testi ed email. "Synlab" non
  colpisce "Synclab" (il gestionale di laboratorio).
- I file il cui contenuto non si può leggere (scansioni senza testo, immagini, firmati non apribili) sono elencati a parte: si
  controllano a mano. La Suite non fa OCR in questa ricerca.
- Eliminazione: si scelgono le righe (preselezionate solo quelle con il termine nel nome, esclusi i contratti firmati e i fascicoli già
  presentati o autorizzati, che vanno spuntati a mano), si scrive `ELIMINA`. Il file sparisce dal database e dall'archivio; resta
  l'audit `PULIZIA_ALLEGATI_ELIMINATI` con nome e origine, mai il contenuto. Non è recuperabile dalla Suite.
- Codice: `server/src/lib/puliziaAllegati.js`, `server/src/routes/puliziaAllegati.js`, `web/src/pages/admin/PuliziaAllegati.jsx`,
  test `server/test/pulizia-allegati.test.mjs`.
