-- Ordini v0.99.14 (CEO, 28/11/2026): Magazzino TD, il magazzino interno gestito dall'Area Operations.
-- Contiene articoli interni che non saranno mai nel magazzino di Silva (source 'TD'). Un ordine con articoli Silva e articoli TD si
-- divide all'approvazione: la parte Silva va a Silva, la parte TD diventa un ordine figlio (canale 'TD', numero con suffisso -TD)
-- inviato per email al Magazzino TD. La giacenza TD scala quando la merce esce verso il destinatario (movimento USCITA). Idempotente.
ALTER TABLE articles DROP CONSTRAINT IF EXISTS articles_source_check;
ALTER TABLE articles ADD CONSTRAINT articles_source_check CHECK (source IN ('MOD252','SILVA','MANUALE','TD'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'SILVA';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_channel_check;
ALTER TABLE orders ADD CONSTRAINT orders_channel_check CHECK (channel IN ('SILVA','TD'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS parent_order_id INT REFERENCES orders(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS td_email_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS orders_channel_idx ON orders (channel, status);
CREATE TABLE IF NOT EXISTS td_stock_movements (
  id          SERIAL PRIMARY KEY,
  article_id  INT NOT NULL REFERENCES articles(id),
  kind        TEXT NOT NULL CHECK (kind IN ('CARICO','USCITA','RETTIFICA')),
  qty         INT NOT NULL,                       -- confezioni, con segno: CARICO > 0, USCITA < 0, RETTIFICA con il segno della correzione
  order_id    INT REFERENCES orders(id) ON DELETE SET NULL,
  line_id     INT,
  lot         TEXT,
  expiry      DATE,
  note        TEXT,
  user_id     INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (qty <> 0)
);
CREATE INDEX IF NOT EXISTS td_stock_movements_article_idx ON td_stock_movements (article_id);
CREATE INDEX IF NOT EXISTS td_stock_movements_order_idx ON td_stock_movements (order_id);
INSERT INTO app_settings (key, value) VALUES ('td_warehouse_email', 'acquisti@toscanadiagnostica.it') ON CONFLICT (key) DO NOTHING;
