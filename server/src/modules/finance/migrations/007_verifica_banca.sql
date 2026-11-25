-- Finance Management v0.98.0 (CEO, 25/11/2026): la scadenza di un affitto o di una bolletta si verifica sul conto corrente. Il
-- movimento bancario che la chiude resta agganciato alla scadenza (un movimento chiude una sola scadenza). Idempotente.
ALTER TABLE schedule_done ADD COLUMN IF NOT EXISTS bank_tx_id BIGINT;
ALTER TABLE schedule_done ADD COLUMN IF NOT EXISTS source TEXT;           -- 'BANCA' = chiusa dalla verifica automatica sul conto
CREATE UNIQUE INDEX IF NOT EXISTS schedule_done_bank_tx_uq ON schedule_done (bank_tx_id) WHERE bank_tx_id IS NOT NULL;
