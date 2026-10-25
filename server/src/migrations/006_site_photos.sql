-- Foto delle sedi (fino a 3 per sede), file su Azure Blob con scope SITE
ALTER TABLE files DROP CONSTRAINT IF EXISTS files_scope_check;
ALTER TABLE files ADD CONSTRAINT files_scope_check CHECK (scope IN ('PERSONAL','POST','NEWS','AVATAR','DOC','INGEST','SITE','OTHER'));
ALTER TABLE sites ADD COLUMN IF NOT EXISTS photo_file_ids INT[] NOT NULL DEFAULT '{}';
