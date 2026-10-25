-- Organigramma aziendale (TD-SGI-IDL007 Allegato 1)
CREATE TABLE org_units (
  id          SERIAL PRIMARY KEY,
  parent_id   INT REFERENCES org_units(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'FUNZIONE' CHECK (kind IN ('DIREZIONE','LINEA','SEDE','FUNZIONE','STAFF')),
  name        TEXT NOT NULL,
  role_title  TEXT,
  head_name   TEXT,
  resource_id INT REFERENCES resources(id) ON DELETE SET NULL,
  area_id     INT REFERENCES areas(id) ON DELETE SET NULL,
  tbd         BOOLEAN NOT NULL DEFAULT FALSE,
  notes       TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX org_units_parent_idx ON org_units(parent_id);

-- I documenti di riferimento (CCNL, organigramma) condividono la stessa tabella
ALTER TABLE ccnl_documents ADD COLUMN scope TEXT NOT NULL DEFAULT 'CCNL';
CREATE INDEX ccnl_documents_scope_idx ON ccnl_documents(scope);
