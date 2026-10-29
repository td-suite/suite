-- Accessi esterni dalle Legal entity (richiesta del CEO, 29/10/2026): partner che ospitano punti prelievo (royalties in Cash)
-- e clienti service (portale, NC, circolari, ticket, rubrica). Due profili di accesso di sistema (nome non modificabile) e il flag
-- "contatto pubblico" sulle unità dell'organigramma: gli esterni vedono in Rubrica solo le persone di quelle unità e aprono ticket
-- solo verso di esse.

-- Profili di sistema: seminati qui, il nome non si cambia, non si eliminano (routes/accessProfiles.js)
ALTER TABLE access_profiles ADD COLUMN IF NOT EXISTS system BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE access_profiles ADD COLUMN IF NOT EXISTS system_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS access_profiles_system_key_uq ON access_profiles (system_key) WHERE system_key IS NOT NULL;

INSERT INTO access_profiles (name, description, is_default, sort_order, items, system, system_key) VALUES
  ('Partner ospitante', 'Legal entity (partner o cliente) che ospita punti prelievo Toscana Diagnostica: royalties mensili in Cash sulle sole sedi ospitate, circolari, ticket, rubrica dei contatti pubblici', FALSE, 80, '[
    {"module_key":"cash","profile":"PARTNER"},
    {"module_key":"circolari","profile":"VIEWER"},
    {"module_key":"rubrica","profile":"LETTORE"}
  ]'::jsonb, TRUE, 'PARTNER_OSPITANTE'),
  ('Cliente service', 'Laboratorio o struttura cliente del service: Portale Service e SGI in consultazione, non conformità delle proprie sedi, circolari, ticket, rubrica dei contatti pubblici', FALSE, 81, '[
    {"module_key":"service","profile":"LETTORE"},
    {"module_key":"sgi","profile":"LETTORE"},
    {"module_key":"nc","profile":"SEDE"},
    {"module_key":"circolari","profile":"VIEWER"},
    {"module_key":"rubrica","profile":"LETTORE"}
  ]'::jsonb, TRUE, 'CLIENTE_SERVICE')
ON CONFLICT (name) DO UPDATE SET system = TRUE, system_key = EXCLUDED.system_key;

-- Unità dell'organigramma raggiungibili dagli esterni (rubrica e ticket). Si imposta in Amministrazione > Organizzazione.
ALTER TABLE org_units ADD COLUMN IF NOT EXISTS public_contact BOOLEAN NOT NULL DEFAULT FALSE;
-- Seme iniziale sulle unità già presenti (le stesse regole le riapplica il server una volta sola se l'organigramma viene caricato dopo)
UPDATE org_units SET public_contact = TRUE
 WHERE kind = 'DIREZIONE'
    OR lower(unaccent(name)) LIKE 'hsq%'
    OR lower(unaccent(name)) LIKE 'flow & back office%'
    OR lower(unaccent(name)) LIKE 'laboratorio di analisi%'
    OR lower(unaccent(name)) LIKE 'service%'
    OR lower(unaccent(name)) IN ('b2b', 'service/b2b', 'service / b2b')
    OR lower(unaccent(name)) LIKE 'retail & communications%';
