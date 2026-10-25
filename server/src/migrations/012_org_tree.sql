-- Organigramma: unità organizzative ad albero (direzione, aree, sedi, reparti, funzioni) e incarichi (persona + ruolo per unità,
-- anche più incarichi per persona; is_head = responsabile dell'unità). I reparti per sede diventano nodi sotto il nodo della sede.
ALTER TABLE org_units ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES org_units(id) ON DELETE SET NULL;
ALTER TABLE org_units ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'REPARTO' CHECK (kind IN ('DIREZIONE','AREA','SEDE','REPARTO','FUNZIONE'));
ALTER TABLE org_units ALTER COLUMN site_id DROP NOT NULL;
DROP INDEX IF EXISTS org_units_site_name_uq;
CREATE UNIQUE INDEX IF NOT EXISTS org_units_parent_name_uq ON org_units (coalesce(parent_id, 0), lower(name));
CREATE TABLE IF NOT EXISTS org_positions (
  id          SERIAL PRIMARY KEY,
  unit_id     INT NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
  person_id   INT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role_id     INT REFERENCES job_roles(id) ON DELETE SET NULL,
  is_head     BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INT NOT NULL DEFAULT 100,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_positions_uq ON org_positions (unit_id, person_id, coalesce(role_id, 0));
-- nodo radice e nodi sede per i reparti già esistenti
INSERT INTO org_units (name, kind, sort_order) SELECT 'Toscana Diagnostica', 'DIREZIONE', 0 WHERE NOT EXISTS (SELECT 1 FROM org_units WHERE kind='DIREZIONE');
INSERT INTO org_units (name, kind, site_id, parent_id, sort_order)
  SELECT s.name, 'SEDE', s.id, (SELECT id FROM org_units WHERE kind='DIREZIONE' ORDER BY id LIMIT 1), 100
  FROM sites s WHERE s.id IN (SELECT DISTINCT site_id FROM org_units WHERE kind='REPARTO' AND site_id IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM org_units u WHERE u.kind='SEDE' AND u.site_id=s.id);
UPDATE org_units r SET parent_id = s.id FROM org_units s WHERE r.kind='REPARTO' AND r.parent_id IS NULL AND s.kind='SEDE' AND s.site_id=r.site_id;
-- il responsabile di reparto già indicato diventa un incarico
INSERT INTO org_positions (unit_id, person_id, role_id, is_head)
  SELECT u.id, u.head_person_id, p.role_id, TRUE FROM org_units u JOIN people p ON p.id=u.head_person_id WHERE u.head_person_id IS NOT NULL
  ON CONFLICT DO NOTHING;
