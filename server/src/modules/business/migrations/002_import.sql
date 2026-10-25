-- Importazione dello status quo da pacchetti ZIP (manifest + documenti): chiavi di importazione idempotenti e registro delle esecuzioni
ALTER TABLE partners ADD COLUMN IF NOT EXISTS import_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS partners_import_key_uq ON partners (import_key) WHERE import_key IS NOT NULL;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS import_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS contracts_import_key_uq ON contracts (import_key) WHERE import_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS import_runs (
  id        SERIAL PRIMARY KEY,
  filename  TEXT NOT NULL,
  dry_run   BOOLEAN NOT NULL DEFAULT FALSE,
  user_id   INT REFERENCES users(id),
  summary   JSONB NOT NULL DEFAULT '{}'::jsonb,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
