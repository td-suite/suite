-- Cessazione: motivo e note, oltre alla decorrenza (terminated_at)
ALTER TABLE resources ADD COLUMN termination_reason TEXT;
ALTER TABLE resources ADD COLUMN termination_notes TEXT;
