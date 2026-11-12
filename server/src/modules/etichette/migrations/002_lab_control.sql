-- Lab Control (v0.71.0, richieste del CEO del 12/11/2026): il widget Label diventa "Lab Control" (chiave tecnica `etichette` invariata).
-- Elenco delle accettazioni StudioLab con le fasi di lavorazione, scheda con esami, campioni e fattura, cruscotto, campioni in viaggio,
-- ritardi, tempi di refertazione, esami non eseguiti, clienti. Fonte: copia Synclab della Suite (sola lettura). docs/LAB_CONTROL.md.
-- Migrazione idempotente: IF NOT EXISTS ovunque, nessun dato toccato. Gli indici sulla copia synclab servono a tenere reattivo l'elenco con
-- decine di migliaia di accettazioni (filtri per data, stato, numero, barcode, campioni in viaggio, righe non eseguite).

-- Letture puntuali dal gestionale ("Aggiorna dal gestionale" sulla scheda): l'accettazione com'è adesso nel gestionale, SENZA paziente
-- (testata, righe, campioni). Sulla scheda prevale sulla copia finché la copia non è più recente; si purgano con le identità recenti.
CREATE TABLE IF NOT EXISTS lc_letture (
  instance_id TEXT NOT NULL,
  id          TEXT NOT NULL,
  raw         JSONB NOT NULL,
  letto_il    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, id)
);
CREATE INDEX IF NOT EXISTS lc_letture_letto ON lc_letture (letto_il);

-- Indici sulla copia (se mancano): numero di accettazione e barcode (ricerca, anche del Desk NC e della ricerca globale), creazione,
-- referto, accettazioni in corso, campioni raccolti e non ancora arrivati, righe non eseguite.
CREATE INDEX IF NOT EXISTS lc_requests_numero_idx ON synclab.requests (request_number);
CREATE INDEX IF NOT EXISTS lc_requests_creata_idx ON synclab.requests (created_at_local);
CREATE INDEX IF NOT EXISTS lc_requests_referto_idx ON synclab.requests (report_at_local) WHERE report_at_local IS NOT NULL;
CREATE INDEX IF NOT EXISTS lc_requests_in_corso_idx ON synclab.requests (created_at_local) WHERE state IN (15, 18, 20, 25) AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS lc_samples_barcode_idx ON synclab.samples (barcode);
CREATE INDEX IF NOT EXISTS lc_samples_viaggio_idx ON synclab.samples (collected_at_local) WHERE checked_in_at_local IS NULL AND collected_at_local IS NOT NULL;
CREATE INDEX IF NOT EXISTS lc_samples_raccolto_idx ON synclab.samples (coalesce(collected_at_local, sample_at_local));
CREATE INDEX IF NOT EXISTS lc_items_non_eseguiti_idx ON synclab.request_items (instance_id, request_id) WHERE not_performed_code IS NOT NULL;
