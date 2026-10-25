-- Il codice StudioLAB sta sulla sede (punto inviante), non sull'organizzazione (legal entity)
DROP INDEX IF EXISTS organizations_studiolab_uq;
ALTER TABLE organizations DROP COLUMN IF EXISTS studiolab_code;
