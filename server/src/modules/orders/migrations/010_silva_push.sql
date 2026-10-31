-- Trasmissione dell'ordine approvato al gestionale Silva (richiesta del CEO, 31/10/2026): dopo la verifica dell'Area Operations
-- (fase 2) l'approvazione invia l'ordine in API al magazzino (fase 3). Stato della trasmissione sull'ordine.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_sent_at TIMESTAMPTZ;        -- ultimo invio riuscito
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_send_status TEXT;           -- INVIATO | ERRORE | NULL (mai tentato)
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_send_message TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_send_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_last_attempt_at TIMESTAMPTZ;
