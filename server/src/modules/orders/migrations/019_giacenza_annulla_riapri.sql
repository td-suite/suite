-- v0.87.0 · Giacenza mensile: annullamento, riapertura ed eliminazione (richiesta del CEO del 19/11/2026).
-- Nuovo stato ANNULLATO e traccia di chi ha annullato o riaperto. Idempotente e non distruttiva.
ALTER TABLE stock_counts DROP CONSTRAINT IF EXISTS stock_counts_status_check;
ALTER TABLE stock_counts ADD CONSTRAINT stock_counts_status_check CHECK (status IN ('BOZZA','CONFERMATO','ANNULLATO'));
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS cancelled_by INT REFERENCES users(id);
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS reopened_by INT REFERENCES users(id);
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS reopened_at TIMESTAMPTZ;
