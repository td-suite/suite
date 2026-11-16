-- v0.78.0 · Giacenza mensile: più lotti per lo stesso articolo (richiesta del CEO del 16/11/2026). Di un articolo possono esserci in
-- magazzino più lotti con scadenze diverse: la riga dell'articolo si replica, con le stesse caratteristiche, e ogni replica ha la sua
-- quantità, il suo lotto e la sua scadenza.
-- La riga di stock_count_lines resta una per articolo ed è il PRIMO lotto: counted_qty continua a essere il TOTALE dell'articolo (è il
-- dato che usano rettifiche e formula di riordino, che quindi non cambiano); lot_qty è la quantità del solo primo lotto quando ce ne sono
-- altri (NULL = tutto il conteggio è del primo lotto). I lotti successivi stanno in stock_count_lots. Idempotente e non distruttiva.
ALTER TABLE stock_count_lines ADD COLUMN IF NOT EXISTS lot_qty INT CHECK (lot_qty IS NULL OR lot_qty >= 0);
CREATE TABLE IF NOT EXISTS stock_count_lots (
  id          SERIAL PRIMARY KEY,
  count_id    INT NOT NULL,
  article_id  INT NOT NULL,
  position    INT NOT NULL DEFAULT 1,
  qty         INT NOT NULL DEFAULT 0 CHECK (qty >= 0),
  lot         TEXT,
  expiry      DATE,
  FOREIGN KEY (count_id, article_id) REFERENCES stock_count_lines(count_id, article_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS stock_count_lots_riga ON stock_count_lots (count_id, article_id, position);
