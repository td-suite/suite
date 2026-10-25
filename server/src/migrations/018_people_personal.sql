-- Dati personali della persona (dal file risorse): luogo di nascita, partita IVA, residenza. Visibili solo agli amministratori.
ALTER TABLE people ADD COLUMN IF NOT EXISTS birth_place TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS vat_number TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS zip TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE people ADD COLUMN IF NOT EXISTS province TEXT;
