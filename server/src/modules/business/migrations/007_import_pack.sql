-- Caricamento dello status quo dei contratti B2C/B2B e dei fascicoli di autorizzazione dalle cartelle OneDrive (richiesta del CEO,
-- 28/10/2026): pacchetti ZIP (manifest.json + files/) importati da Business > Impostazioni. Chiavi di importazione idempotenti su
-- contratti e fascicoli (rieseguire non duplica), registro delle esecuzioni, e archivio dei documenti su Azure Blob Storage quando
-- configurato (lib/blob.js): il database Render da 1 GB non può contenere i fascicoli (centinaia di MB), quindi `data` diventa
-- facoltativa e `blob_path` indica dove sta il contenuto. I file caricati a mano continuano a seguire la stessa regola (blob se
-- configurato, altrimenti nel database).
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS import_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS contracts_import_key_uq ON contracts (import_key) WHERE import_key IS NOT NULL;
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS import_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS dossiers_import_key_uq ON dossiers (import_key) WHERE import_key IS NOT NULL;

ALTER TABLE contract_files ALTER COLUMN data DROP NOT NULL;
ALTER TABLE contract_files ADD COLUMN IF NOT EXISTS blob_path TEXT;
ALTER TABLE contract_files ADD COLUMN IF NOT EXISTS label TEXT;          -- descrizione o percorso di origine del documento
ALTER TABLE dossier_files ALTER COLUMN data DROP NOT NULL;
ALTER TABLE dossier_files ADD COLUMN IF NOT EXISTS blob_path TEXT;

CREATE TABLE IF NOT EXISTS import_runs (
  id        SERIAL PRIMARY KEY,
  filename  TEXT NOT NULL,
  dry_run   BOOLEAN NOT NULL DEFAULT FALSE,
  user_id   INT REFERENCES users(id),
  summary   JSONB NOT NULL DEFAULT '{}'::jsonb,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
