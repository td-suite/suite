-- Ricerca prospect (v0.74.1): avanzamento per provincia, avvisi delle province non riuscite, ricerche interrotte da un riavvio del server
ALTER TABLE scout_ricerche ADD COLUMN IF NOT EXISTS avanzamento TEXT;
ALTER TABLE scout_ricerche ADD COLUMN IF NOT EXISTS avvisi JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE scout_ricerche ADD COLUMN IF NOT EXISTS aggiornata_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE scout_ricerche DROP CONSTRAINT IF EXISTS scout_ricerche_stato_check;
ALTER TABLE scout_ricerche ADD CONSTRAINT scout_ricerche_stato_check CHECK (stato IN ('IN_CORSO','FATTA','ERRORE','ANNULLATA'));
