-- Ricerca prospect (v0.75.0): fonti ufficiali del Ministero della Salute (farmacie, parafarmacie, ospedali e case di cura) ed elenchi
-- caricati da file. Idempotente.
ALTER TABLE scout_candidati DROP CONSTRAINT IF EXISTS scout_candidati_fonte_check;
ALTER TABLE scout_candidati ADD CONSTRAINT scout_candidati_fonte_check CHECK (fonte IN ('OSM','MANUALE','ACCOUNT','MINISTERO','ELENCO'));
ALTER TABLE scout_ricerche ADD COLUMN IF NOT EXISTS fonte TEXT NOT NULL DEFAULT 'OSM';
