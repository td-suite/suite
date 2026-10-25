-- Suite TD · stato dei moduli travasati. Ogni modulo legacy vive in uno schema con il suo nome (room, cash, ...), con le sue tabelle originali.
-- mode: OFF (non ancora travasato) | MIRROR (copia dei dati, aggiornata dal job; l'app originale resta la fonte) | LIVE (la Suite è la fonte; l'app originale va spenta o reindirizzata)
CREATE TABLE module_state (
  key             TEXT PRIMARY KEY REFERENCES modules(key) ON DELETE CASCADE,
  mode            TEXT NOT NULL DEFAULT 'OFF' CHECK (mode IN ('OFF','MIRROR','LIVE')),
  schema_ready    BOOLEAN NOT NULL DEFAULT FALSE,
  last_copy_at    TIMESTAMPTZ,
  last_copy_ms    INT,
  last_copy_stats JSONB,
  last_error      TEXT,
  live_since      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by      INT REFERENCES users(id)
);
