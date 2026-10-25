-- Toscana Diagnostica · Finance
-- Schema iniziale: utenti, istanze di autorizzazione al pagamento, firme, allegati, archivio

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Sessioni (express-session / connect-pg-simple)
CREATE TABLE "session" (
  sid    VARCHAR NOT NULL COLLATE "default",
  sess   JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL,
  PRIMARY KEY (sid)
);
CREATE INDEX session_expire_idx ON "session" (expire);

-- Utenti: quattro profili (Finance Support, CEO, CFO, Consultazione) più il flag amministratore
CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  title                TEXT,                                   -- Dott., Dott.ssa, Avv. (compare sul modulo)
  role                 TEXT NOT NULL CHECK (role IN ('SUPPORT','CEO','CFO','VIEWER')),
  is_admin             BOOLEAN NOT NULL DEFAULT FALSE,
  auth_provider        TEXT NOT NULL DEFAULT 'ENTRA' CHECK (auth_provider IN ('LOCAL','ENTRA','BOTH')),
  password_hash        TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  totp_secret          TEXT,
  totp_enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  entra_oid            TEXT,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  failed_logins        INT NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
-- un solo CEO e un solo CFO attivi: sono i firmatari
CREATE UNIQUE INDEX users_signer_uq ON users (role) WHERE role IN ('CEO','CFO') AND active;

CREATE TABLE audit_log (
  id        BIGSERIAL PRIMARY KEY,
  user_id   INT REFERENCES users(id),
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  data      JSONB,
  ip        TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

-- Conti di addebito della Società
CREATE TABLE bank_accounts (
  id         SERIAL PRIMARY KEY,
  bank_name  TEXT NOT NULL,
  iban       TEXT NOT NULL,
  label      TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 100
);

-- Anagrafica beneficiari e storico IBAN (prevenzione frodi: nuovo IBAN = conferma via canale indipendente)
CREATE TABLE beneficiaries (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  tax_id     TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX beneficiaries_name_idx ON beneficiaries (lower(name));
CREATE TABLE beneficiary_ibans (
  id             SERIAL PRIMARY KEY,
  beneficiary_id INT NOT NULL REFERENCES beneficiaries(id) ON DELETE CASCADE,
  iban           TEXT NOT NULL,
  bic            TEXT,
  bank           TEXT,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at    TIMESTAMPTZ,
  verified_by    INT REFERENCES users(id),
  verified_note  TEXT,
  UNIQUE (beneficiary_id, iban)
);

-- Protocollo progressivo per anno (AP-2026-0001)
CREATE TABLE protocol_counters (
  year INT PRIMARY KEY,
  last INT NOT NULL DEFAULT 0
);

-- Istanze di autorizzazione al pagamento (replica digitale del modulo)
CREATE TABLE payment_requests (
  id                     SERIAL PRIMARY KEY,
  protocol               TEXT UNIQUE,
  status                 TEXT NOT NULL DEFAULT 'BOZZA' CHECK (status IN ('BOZZA','IN_FIRMA','RIFIUTATA','FIRMATA','ESEGUITA','ANNULLATA')),
  version                INT NOT NULL DEFAULT 1,                 -- cresce a ogni modifica dei dati dopo l'invio in firma
  content_hash           TEXT,                                   -- SHA-256 del contenuto firmato
  -- intestazione
  request_date           DATE NOT NULL,
  requester              TEXT NOT NULL,
  cost_center            TEXT,
  -- 1. dati del pagamento
  beneficiary_id         INT REFERENCES beneficiaries(id),
  beneficiary_name       TEXT NOT NULL,
  beneficiary_tax_id     TEXT,
  beneficiary_iban       TEXT NOT NULL,
  beneficiary_bic        TEXT,
  beneficiary_bank       TEXT,
  amount                 NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  purpose                TEXT NOT NULL,
  doc_type               TEXT NOT NULL CHECK (doc_type IN ('FATTURA','CONTRATTO','ORDINE','ALTRO')),
  doc_other              TEXT,
  doc_number             TEXT,
  doc_date               DATE,
  bank_account_id        INT REFERENCES bank_accounts(id),
  debit_account          TEXT,                                   -- banca e IBAN di addebito (copia al momento dell'istanza)
  payment_method         TEXT NOT NULL CHECK (payment_method IN ('SEPA','URGENTE','ESTERO','F24','ALTRO')),
  payment_method_other   TEXT,
  value_date             DATE,
  -- 2. scaglione
  tier                   TEXT CHECK (tier IN ('SINGOLA','CONGIUNTA','CDA')),
  single_signer          TEXT CHECK (single_signer IN ('CEO','CFO')),  -- solo per lo scaglione a firma singola
  board_number           TEXT,
  board_date             DATE,
  prior_approval         BOOLEAN NOT NULL DEFAULT FALSE,         -- paghe, imposte, contributi, rate, già approvato
  prior_approval_ref     TEXT,
  -- 3. verifiche preliminari (sei caselle)
  checks                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_iban               BOOLEAN NOT NULL DEFAULT FALSE,
  iban_verified_note     TEXT,
  aggregation            JSONB,                                  -- istanze correlate rilevate all'invio in firma (anti-frazionamento)
  notes                  TEXT,
  -- ciclo di vita
  created_by             INT NOT NULL REFERENCES users(id),
  submitted_at           TIMESTAMPTZ,
  signed_at              TIMESTAMPTZ,
  rejected_reason        TEXT,
  -- 5. esecuzione (tesoreria)
  executed_by            TEXT,
  executed_at            DATE,
  cro_trn                TEXT,
  executed_recorded_by   INT REFERENCES users(id),
  executed_recorded_at   TIMESTAMPTZ,
  cancelled_at           TIMESTAMPTZ,
  cancel_reason          TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX payment_requests_status_idx ON payment_requests (status);
CREATE INDEX payment_requests_date_idx ON payment_requests (request_date DESC);
CREATE INDEX payment_requests_iban_idx ON payment_requests (beneficiary_iban);

-- Link di firma inviati via email (token monouso, conservato solo come hash)
CREATE TABLE sign_tokens (
  id           SERIAL PRIMARY KEY,
  request_id   INT NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('CEO','CFO')),
  user_id      INT NOT NULL REFERENCES users(id),
  token_hash   TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  version      INT NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reminder     BOOLEAN NOT NULL DEFAULT FALSE,
  used_at      TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
CREATE INDEX sign_tokens_request_idx ON sign_tokens (request_id);

-- Firme apposte
CREATE TABLE signatures (
  id           SERIAL PRIMARY KEY,
  request_id   INT NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('CEO','CFO')),
  user_id      INT NOT NULL REFERENCES users(id),
  user_name    TEXT NOT NULL,
  user_email   TEXT NOT NULL,
  signed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip           TEXT,
  user_agent   TEXT,
  auth_method  TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  version      INT NOT NULL,
  token_id     INT REFERENCES sign_tokens(id),
  valid        BOOLEAN NOT NULL DEFAULT TRUE,
  voided_at    TIMESTAMPTZ,
  voided_reason TEXT
);
CREATE INDEX signatures_request_idx ON signatures (request_id);

-- Cronologia dell'istanza
CREATE TABLE request_events (
  id         BIGSERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  user_id    INT REFERENCES users(id),
  note       TEXT,
  data       JSONB,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX request_events_request_idx ON request_events (request_id, at);

-- Documentazione di supporto (fattura, contratto, ordine, SAL, delibera)
CREATE TABLE request_attachments (
  id          SERIAL PRIMARY KEY,
  request_id  INT NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  category    TEXT NOT NULL DEFAULT 'SUPPORTO',
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INT NOT NULL,
  sha256      TEXT NOT NULL,
  data        BYTEA NOT NULL,
  uploaded_by INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX request_attachments_request_idx ON request_attachments (request_id);

-- Moduli generati (PDF firmato, PDF con esecuzione)
CREATE TABLE generated_documents (
  id         SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('MODULO_FIRMATO','MODULO_ESEGUITO')),
  filename   TEXT NOT NULL,
  mime       TEXT NOT NULL,
  size       INT NOT NULL,
  sha256     TEXT NOT NULL,
  data       BYTEA NOT NULL,
  version    INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX generated_documents_request_idx ON generated_documents (request_id);
