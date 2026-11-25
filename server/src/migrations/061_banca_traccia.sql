-- v0.98.4 (25/11/2026): traccia tecnica dell'ultima lettura dei movimenti di un conto (richieste fatte a Enable Banking, esito, movimenti
-- ricevuti e salvati), per capire dove una banca rifiuta. Nessun dato dei movimenti nella traccia. Idempotente.
ALTER TABLE bank_accounts ADD COLUMN IF NOT EXISTS last_trace JSONB;
