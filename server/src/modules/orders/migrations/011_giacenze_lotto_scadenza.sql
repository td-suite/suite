-- Giacenze mensili (fase 7): nella tabella da compilare si registrano anche lotto e scadenza (richiesta del CEO, 04/11/2026).
-- Lotto come testo libero (più lotti separati da virgola), scadenza come data della confezione che scade prima.
ALTER TABLE stock_count_lines ADD COLUMN IF NOT EXISTS lot TEXT, ADD COLUMN IF NOT EXISTS expiry DATE;
ALTER TABLE stock_count_extras ADD COLUMN IF NOT EXISTS lot TEXT, ADD COLUMN IF NOT EXISTS expiry DATE;
