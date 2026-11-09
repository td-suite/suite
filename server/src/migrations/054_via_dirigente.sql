-- 09/11/2026 (CEO): via la qualifica "Dirigente" dalle persone: i dirigenti sono dipendenti. Le persone già marcate DIRIGENTE
-- diventano DIPENDENTE (la qualifica contrattuale resta in Contratti del personale). Idempotente.
UPDATE people SET kind = 'DIPENDENTE' WHERE kind = 'DIRIGENTE';
ALTER TABLE people DROP CONSTRAINT IF EXISTS people_kind_check;
ALTER TABLE people ADD CONSTRAINT people_kind_check CHECK (kind IN ('DIPENDENTE','LP','MEDICO','SANITARIO','ESTERNO'));
