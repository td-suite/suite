-- Ordini v0.99.0 (richiesta del 25/11/2026): un esame può consumare più materiali (es. droghe: provetta urine, tappo a vite, sigilli).
-- Le righe esame → articolo erano già più d'una per esame; mancava dire QUALE è il contenitore del campione e quali sono materiali
-- in più. contenitore = TRUE: l'articolo è il contenitore del campione (si conta una volta per campione, anche se serve più esami);
-- FALSE: materiale consumato a ogni esame (si conta esami × unità per esame). Le righe esistenti restano contenitori: nulla cambia
-- finché non si modifica un esame. Idempotente.
ALTER TABLE exam_mappings ADD COLUMN IF NOT EXISTS contenitore BOOLEAN NOT NULL DEFAULT TRUE;
