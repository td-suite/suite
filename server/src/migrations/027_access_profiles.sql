-- Profili di accesso (richiesta del CEO, 28/10/2026): pacchetti di permessi "widget → profilo" da assegnare con un clic a uno
-- o più utenti. Il profilo con is_default = TRUE viene applicato a ogni nuovo account e, su richiesta, a tutti gli utenti.
-- I tre profili iniziali sono seminati una sola volta (ON CONFLICT DO NOTHING): il CEO può modificarli dall'Amministrazione.
CREATE TABLE IF NOT EXISTS access_profiles (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  items       JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ "module_key": "cash", "profile": "ADMIN" }, ...]
  sort_order  INT NOT NULL DEFAULT 100,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- un solo profilo predefinito
CREATE UNIQUE INDEX IF NOT EXISTS access_profiles_default_uq ON access_profiles ((is_default)) WHERE is_default;

-- Da quale profilo è nato un grant (NULL = assegnato a mano, da regola o dall'app legacy). Se il profilo viene eliminato il grant resta.
ALTER TABLE grants ADD COLUMN IF NOT EXISTS profile_id INT REFERENCES access_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS grants_profile_idx ON grants (profile_id);

-- Nuova sorgente PROFILE per i grant nati da un profilo di accesso
ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_source_check;
ALTER TABLE grants ADD CONSTRAINT grants_source_check CHECK (source IN ('MANUAL','LEGACY','ORG','SEED','PROFILE'));

INSERT INTO access_profiles (name, description, is_default, sort_order, items) VALUES
  ('Default', 'Assegnato automaticamente a tutti gli utenti', TRUE, 10, '[
    {"module_key":"rubrica","profile":"LETTORE"},
    {"module_key":"ticket","profile":"RESPONSABILE"},
    {"module_key":"circolari","profile":"VIEWER"},
    {"module_key":"sgi","profile":"LETTORE"},
    {"module_key":"cartella","profile":"ADMIN"},
    {"module_key":"room","profile":"VIEWER"},
    {"module_key":"retail","profile":"VIEWER"}
  ]'::jsonb),
  ('Site Manager', 'Responsabile di sede: gestione operativa della propria struttura', FALSE, 20, '[
    {"module_key":"rubrica","profile":"LETTORE"},
    {"module_key":"ticket","profile":"RESPONSABILE"},
    {"module_key":"circolari","profile":"VIEWER"},
    {"module_key":"nc","profile":"SEDE"},
    {"module_key":"sgi","profile":"LETTORE"},
    {"module_key":"orders","profile":"SEDE"},
    {"module_key":"cartella","profile":"ADMIN"},
    {"module_key":"cash","profile":"ADMIN"},
    {"module_key":"room","profile":"PLANNER"},
    {"module_key":"retail","profile":"SEDE"}
  ]'::jsonb),
  ('Direzione', 'Direzione aziendale: tutti i widget operativi con pieni poteri', FALSE, 30, '[
    {"module_key":"rubrica","profile":"LETTORE"},
    {"module_key":"ticket","profile":"RESPONSABILE"},
    {"module_key":"circolari","profile":"PUBBLICATORE"},
    {"module_key":"nc","profile":"SEDE"},
    {"module_key":"sgi","profile":"EDITOR"},
    {"module_key":"service","profile":"EDITOR"},
    {"module_key":"orders","profile":"SEDE"},
    {"module_key":"cartella","profile":"ADMIN"},
    {"module_key":"cash","profile":"ADMIN"},
    {"module_key":"room","profile":"PLANNER"},
    {"module_key":"retail","profile":"SEDE"},
    {"module_key":"integration","profile":"EDITOR"},
    {"module_key":"business","profile":"VIEWER"},
    {"module_key":"comunicazione","profile":"EDITOR"}
  ]'::jsonb)
ON CONFLICT (name) DO NOTHING;
