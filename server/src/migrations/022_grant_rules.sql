-- Regole di accesso: dall'organizzazione (afferenza, ruolo, tipo di sede, responsabilità) ai moduli proposti all'utente.
-- Le proposte restano "proposed" finché un amministratore non le conferma in Utenti.
CREATE TABLE IF NOT EXISTS grant_rules (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  unit_id     INT REFERENCES org_units(id) ON DELETE CASCADE,     -- afferenza in questa unità o sotto di essa
  role_id     INT REFERENCES job_roles(id) ON DELETE CASCADE,     -- oppure/e questo ruolo
  site_kind   TEXT,                                                -- oppure/e sede di lavoro di questo tipo (PUNTO_PRELIEVI, LABORATORIO...)
  only_heads  BOOLEAN NOT NULL DEFAULT FALSE,                      -- solo chi è responsabile di un'unità
  module_key  TEXT NOT NULL REFERENCES modules(key) ON DELETE CASCADE,
  profile     TEXT NOT NULL,
  scope       TEXT NOT NULL DEFAULT 'SITE' CHECK (scope IN ('SITE','ALL')),   -- limitata alla sede della persona o a tutte
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 100,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
