-- Exit fee: accordo privato estraneo al rapporto di lavoro aziendale. Rimosso da schema, checklist e dossier.
DELETE FROM attachments WHERE category = 'EXIT_FEE' OR filename ILIKE '%exit%fee%';
DELETE FROM dossier_requirements WHERE category = 'EXIT_FEE';
ALTER TABLE employments DROP COLUMN IF EXISTS exit_fee;
