-- Dirigenti: a chi riporta (testo libero usato nella lettera di assunzione)
ALTER TABLE employments ADD COLUMN reports_to TEXT;
-- Documenti importati (contratti già sottoscritti caricati come tempo zero)
ALTER TABLE employments ADD COLUMN imported_from TEXT;
