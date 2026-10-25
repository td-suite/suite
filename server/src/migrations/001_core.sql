-- Suite TD · schema core (identità, profili, anagrafiche, audit, notifiche)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- Sessioni (connect-pg-simple)
CREATE TABLE IF NOT EXISTS session (
  sid    VARCHAR NOT NULL PRIMARY KEY,
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);
CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);

-- Organizzazioni: Toscana Diagnostica e le sue società, clienti, partner, fornitori, target M&A
CREATE TABLE organizations (
  id            SERIAL PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'CLIENTE' CHECK (kind IN ('GRUPPO','SOCIETA','CLIENTE','PARTNER','FORNITORE','TARGET','ALTRO')),
  code          TEXT UNIQUE,
  name          TEXT NOT NULL,
  vat_number    TEXT,
  tax_code      TEXT,
  sdi           TEXT,
  pec           TEXT,
  email         TEXT,
  phone         TEXT,
  address       TEXT, zip TEXT, city TEXT, province TEXT,
  website       TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  needs_review  BOOLEAN NOT NULL DEFAULT FALSE,
  legacy_refs   JSONB NOT NULL DEFAULT '{}'::jsonb,    -- {"cash": 3, "orders": 1, "business": 12}
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX organizations_vat_idx ON organizations (vat_number);
CREATE INDEX organizations_name_trgm ON organizations USING gin (lower(name) gin_trgm_ops);

-- Sedi e strutture: anagrafica unica della rete (laboratorio, centri, punti prelievo, strutture clienti service)
CREATE TABLE sites (
  id              SERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,                -- codice breve (es. FI-CEC)
  name            TEXT NOT NULL,
  short_name      TEXT,
  kind            TEXT NOT NULL DEFAULT 'PUNTO_PRELIEVI' CHECK (kind IN ('HEADQUARTER','LABORATORIO','CENTRO_DIAGNOSTICO','POLIAMBULATORIO','PUNTO_PRELIEVI','SERVICE','CENTRO_MEDICO','ALTRO')),
  organization_id INT REFERENCES organizations(id),
  address         TEXT, zip TEXT, city TEXT, province TEXT,
  lat             NUMERIC(9,6), lng NUMERIC(9,6),
  phone           TEXT, email TEXT,
  manager_name    TEXT,
  opening_hours   TEXT,
  legacy_brand    TEXT,
  studiolab_code  TEXT,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  needs_review    BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order      INT NOT NULL DEFAULT 100,
  legacy_refs     JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"retail": 4, "cash": 7, "nc": 2, "orders": 9, "room": "fi-cec", "contracts": 1}
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sites_name_trgm ON sites USING gin (lower(name) gin_trgm_ops);

-- Persone: dipendenti, liberi professionisti, medici, referenti esterni. Distinte dagli utenti (una persona può non avere accesso)
CREATE TABLE people (
  id                SERIAL PRIMARY KEY,
  kind              TEXT NOT NULL DEFAULT 'DIPENDENTE' CHECK (kind IN ('DIPENDENTE','LP','MEDICO','SANITARIO','ESTERNO','DIRIGENTE')),
  status            TEXT NOT NULL DEFAULT 'ATTIVO' CHECK (status IN ('CANDIDATO','IMPEGNO','ATTIVO','CESSATO')),
  last_name         TEXT NOT NULL,
  first_name        TEXT NOT NULL,
  title             TEXT,
  sex               TEXT CHECK (sex IN ('F','M')),
  birth_date        DATE,
  tax_code          TEXT,
  email             TEXT,
  phone             TEXT,
  phone_office      TEXT,
  area              TEXT,                    -- area organizzativa (da Contracts)
  job_title         TEXT,
  discipline        TEXT,                    -- per medici e LP
  manager_person_id INT REFERENCES people(id) ON DELETE SET NULL,
  site_id           INT REFERENCES sites(id) ON DELETE SET NULL,
  organization_id   INT REFERENCES organizations(id) ON DELETE SET NULL,
  photo_file_id     INT,
  hired_at          DATE,
  terminated_at     DATE,
  legacy_refs       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"contracts": 12, "room": 7}
  needs_review      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX people_tax_code_uq ON people (upper(tax_code)) WHERE tax_code IS NOT NULL AND tax_code <> '';
CREATE INDEX people_email_idx ON people (lower(email));
CREATE INDEX people_name_trgm ON people USING gin ((lower(last_name || ' ' || first_name)) gin_trgm_ops);

-- Utenti: una sola identità per persona, qualunque sia il metodo di accesso
CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  title                TEXT,
  phone                TEXT,
  level                TEXT NOT NULL DEFAULT 'USER' CHECK (level IN ('OWNER','ADMIN','USER')),
  status               TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('ACTIVE','PENDING','DISABLED')),
  auth_provider        TEXT NOT NULL DEFAULT 'ENTRA' CHECK (auth_provider IN ('LOCAL','ENTRA','BOTH')),
  password_hash        TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret          TEXT,
  totp_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  entra_oid            TEXT,
  entra_tid            TEXT,
  person_id            INT REFERENCES people(id) ON DELETE SET NULL,
  organization_id      INT REFERENCES organizations(id) ON DELETE SET NULL,
  site_id              INT REFERENCES sites(id) ON DELETE SET NULL,     -- sede principale (meteo, calendario, community)
  lang                 TEXT NOT NULL DEFAULT 'it' CHECK (lang IN ('it','en')),
  avatar_file_id       INT,
  bio                  TEXT,
  notify_email         BOOLEAN NOT NULL DEFAULT TRUE,
  failed_logins        INT NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  legacy_refs          JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {"cash": 5, "nc": 9}: id nelle tabelle users di origine
  created_by           INT REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_entra_oid_idx ON users (entra_oid);
CREATE INDEX users_name_trgm ON users USING gin (lower(full_name) gin_trgm_ops);

-- Moduli (widget): legacy = app esistente raggiunta via SSO; native = dentro la Suite; public = vetrina pubblica
CREATE TABLE modules (
  key          TEXT PRIMARY KEY,
  area         TEXT NOT NULL CHECK (area IN ('DIREZIONE','FINANCE','RETAIL_FLOW','OPERATIONS','HQS','PEOPLE','COMMUNITY')),
  name         TEXT NOT NULL,
  tagline      TEXT,
  description  TEXT,
  icon         TEXT NOT NULL,                       -- nome dell'icona disegnata nel front-end
  kind         TEXT NOT NULL DEFAULT 'LEGACY' CHECK (kind IN ('LEGACY','NATIVE','PUBLIC')),
  legacy_url   TEXT,                                -- es. https://cash.toscanadiagnostica.it
  route        TEXT,                                -- percorso in Suite (nativi) es. /community/news
  restricted   BOOLEAN NOT NULL DEFAULT FALSE,      -- solo l'Owner può assegnarlo (Contracts)
  profiles     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{"key":"ADMIN","label":"Amministratore","scoped":false}, ...]
  scope_type   TEXT CHECK (scope_type IN ('SITE','ORG')),   -- tipo di ambito per i profili "scoped"
  sso_secret   TEXT,                                -- segreto condiviso con l'app legacy (HMAC)
  sort_order   INT NOT NULL DEFAULT 100,
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  counter_sql  TEXT,                                -- facoltativo: query sul DB legacy per il contatore del widget
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Assegnazioni: utente × modulo → profilo (+ ambiti)
CREATE TABLE grants (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_key  TEXT NOT NULL REFERENCES modules(key) ON DELETE CASCADE,
  profile     TEXT NOT NULL,
  proposed    BOOLEAN NOT NULL DEFAULT FALSE,       -- proposta automatica (da organigramma o legacy) non ancora confermata
  source      TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','LEGACY','ORG','SEED')),
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, module_key)
);
CREATE TABLE grant_scopes (
  grant_id   INT NOT NULL REFERENCES grants(id) ON DELETE CASCADE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('SITE','ORG')),
  scope_id   INT NOT NULL,
  PRIMARY KEY (grant_id, scope_type, scope_id)
);

-- Registro delle attività
CREATE TABLE audit_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,
  module_key TEXT,
  entity     TEXT,
  entity_id  TEXT,
  label      TEXT,
  data       JSONB,
  ip         TEXT
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);
CREATE INDEX audit_log_user_idx ON audit_log (user_id, at DESC);

-- Audit di lettura sui dati sensibili (fascicoli, dati personali)
CREATE TABLE read_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  module_key TEXT,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL,
  ip         TEXT
);
CREATE INDEX read_log_entity_idx ON read_log (entity, entity_id, at DESC);

CREATE TABLE app_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES users(id)
);

-- Notifiche in app (e via email / push a valle)
CREATE TABLE notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'INFO',         -- INFO | NEWS | CIRCOLARE | AVVISO | EVENTO | SISTEMA | MODULO
  module_key TEXT,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at, created_at DESC);

CREATE TABLE email_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  to_addr    TEXT NOT NULL,
  subject    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENT','FAILED','LOGGED')),
  error      TEXT,
  ref        TEXT
);

-- File: metadati; il contenuto sta su Azure Blob Storage (blob_path), mai nel database
CREATE TABLE files (
  id            SERIAL PRIMARY KEY,
  scope         TEXT NOT NULL CHECK (scope IN ('PERSONAL','POST','NEWS','AVATAR','DOC','INGEST','OTHER')),
  owner_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  blob_path     TEXT NOT NULL UNIQUE,
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          BIGINT NOT NULL,
  sha256        TEXT,
  folder        TEXT,                                -- sottocartella logica (cartella personale)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);
CREATE INDEX files_owner_idx ON files (owner_user_id, scope, deleted_at);
ALTER TABLE users ADD CONSTRAINT users_avatar_fk FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE people ADD CONSTRAINT people_photo_fk FOREIGN KEY (photo_file_id) REFERENCES files(id) ON DELETE SET NULL;

-- Chiavi API per l'ingestione (PowerShell, partner, sorgenti macchina)
CREATE TABLE api_keys (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  prefix          TEXT NOT NULL UNIQUE,              -- primi 8 caratteri, per riconoscere la chiave nei log
  key_hash        TEXT NOT NULL,                     -- sha256 della chiave completa
  source          TEXT NOT NULL,                     -- es. STUDIOLAB, GIPO, SILVA, POWERSHELL, PARTNER
  site_id         INT REFERENCES sites(id) ON DELETE SET NULL,
  organization_id INT REFERENCES organizations(id) ON DELETE SET NULL,
  scopes          TEXT[] NOT NULL DEFAULT '{}',      -- es. {ingest:people, ingest:files, ingest:*}
  created_by      INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,
  last_used_at    TIMESTAMPTZ
);

-- Registro importazioni: ogni lotto ricevuto dall'API di ingestione
CREATE TABLE ingest_batches (
  id            BIGSERIAL PRIMARY KEY,
  batch_uid     TEXT NOT NULL UNIQUE,                -- idempotenza: lo stesso uid non viene applicato due volte
  source        TEXT NOT NULL,
  dataset       TEXT NOT NULL,                       -- people | sites | files | <modulo>:<dataset>
  api_key_id    INT REFERENCES api_keys(id) ON DELETE SET NULL,
  site_id       INT REFERENCES sites(id) ON DELETE SET NULL,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at    TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','APPLIED','PARTIAL','REJECTED','DUPLICATE')),
  rows_total    INT NOT NULL DEFAULT 0,
  rows_ok       INT NOT NULL DEFAULT 0,
  rows_rejected INT NOT NULL DEFAULT 0,
  checksum      TEXT,
  manifest      JSONB,
  result        JSONB,                               -- esito riga per riga (max 1000 righe), errori
  error         TEXT
);
CREATE INDEX ingest_batches_idx ON ingest_batches (source, dataset, received_at DESC);

-- Sorgenti legacy (database delle app attuali, sola lettura): stato delle sincronizzazioni. Le URL stanno nelle variabili d'ambiente
CREATE TABLE legacy_sources (
  key          TEXT PRIMARY KEY,                     -- cash | orders | shipments | room | nc | retail | business | finance | integration | contracts
  label        TEXT NOT NULL,
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,       -- true quando LEGACY_<KEY>_DATABASE_URL è presente
  last_sync_at TIMESTAMPTZ,
  last_status  TEXT,
  last_error   TEXT,
  stats        JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Indice di ricerca unificato (full-text italiano). Ogni voce porta il perimetro di visibilità (audience)
CREATE TABLE search_index (
  id         BIGSERIAL PRIMARY KEY,
  kind       TEXT NOT NULL,                          -- news | circolare | post | event | notice | person | site | org | module | doc | user
  ref_id     TEXT NOT NULL,
  module_key TEXT,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT NOT NULL,
  audience   JSONB NOT NULL DEFAULT '{"type":"ALL"}'::jsonb,
  sensitive  BOOLEAN NOT NULL DEFAULT FALSE,         -- mai passato a modelli esterni
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  tsv        tsvector GENERATED ALWAYS AS (
               setweight(to_tsvector('italian', coalesce(title,'')), 'A') ||
               setweight(to_tsvector('italian', coalesce(body,'')), 'B')) STORED,
  UNIQUE (kind, ref_id)
);
CREATE INDEX search_index_tsv ON search_index USING gin (tsv);
CREATE INDEX search_index_title_trgm ON search_index USING gin (lower(title) gin_trgm_ops);
