-- Clienti service: ogni codice cliente StudioLAB è un'organizzazione distinta (anche a parità di partita IVA) con una sede gemella SERVICE
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS studiolab_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_studiolab_uq ON organizations (upper(studiolab_code)) WHERE studiolab_code IS NOT NULL AND studiolab_code <> '';
