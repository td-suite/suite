-- Una sede può non avere il suo nodo nell'organigramma (eliminato dall'amministratore): non viene più ricreato
ALTER TABLE sites ADD COLUMN IF NOT EXISTS org_node BOOLEAN NOT NULL DEFAULT TRUE;
