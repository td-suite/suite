-- Catalogo dei ruoli: il ruolo di una persona non è testo libero, si sceglie dal catalogo (Amministrazione > Organizzazione).
-- L'organigramma si compone da sede, ruolo e responsabile. Il campo "area" delle persone non si usa più.
CREATE TABLE IF NOT EXISTS job_roles (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 100,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS job_roles_name_uq ON job_roles (lower(name));
ALTER TABLE people ADD COLUMN IF NOT EXISTS role_id INT REFERENCES job_roles(id) ON DELETE SET NULL;
INSERT INTO job_roles (name) SELECT DISTINCT btrim(job_title) FROM people WHERE job_title IS NOT NULL AND btrim(job_title) <> '' ON CONFLICT DO NOTHING;
UPDATE people p SET role_id = r.id FROM job_roles r WHERE p.role_id IS NULL AND p.job_title IS NOT NULL AND lower(unaccent(btrim(p.job_title))) = lower(unaccent(r.name));
