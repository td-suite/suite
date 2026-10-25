-- Reparti (seconda linea organizzativa): dipendono dalla sede. Una persona ha sede, reparto (facoltativo), ruolo e responsabile.
CREATE TABLE IF NOT EXISTS org_units (
  id              SERIAL PRIMARY KEY,
  site_id         INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  head_person_id  INT REFERENCES people(id) ON DELETE SET NULL,
  phone_ext       TEXT,
  description     TEXT,
  sort_order      INT NOT NULL DEFAULT 100,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS org_units_site_name_uq ON org_units (site_id, lower(name));
ALTER TABLE people ADD COLUMN IF NOT EXISTS unit_id INT REFERENCES org_units(id) ON DELETE SET NULL;
