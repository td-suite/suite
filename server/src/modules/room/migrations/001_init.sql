-- Toscana Diagnostica · Room Planning
-- Schema iniziale

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Utenti. Ruoli: ADMIN (utenti, impostazioni, backup, tutto), PLANNER (pianifica tutte le sedi o quelle assegnate),
-- VIEWER (consultazione e stampa, tutte le sedi o quelle assegnate)
CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('ADMIN','PLANNER','VIEWER')),
  auth_provider        TEXT NOT NULL DEFAULT 'BOTH' CHECK (auth_provider IN ('LOCAL','ENTRA','BOTH')),
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
CREATE UNIQUE INDEX users_email_lower ON users (lower(email));

-- Strutture sanitarie (sedi): il documento JSON è lo stesso modello dati della versione precedente
-- (denominazione, indirizzo, orari, ambulatori, personale, plan.markers…) senza i binari, che stanno in struttura_blobs.
CREATE TABLE strutture (
  id          TEXT PRIMARY KEY,
  data        JSONB NOT NULL,
  version     INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  INT REFERENCES users(id),
  deleted_at  TIMESTAMPTZ,
  deleted_by  INT REFERENCES users(id)
);

-- Binari in base64 (data URL): logo, planimetria PDF (planPdf), immagine della planimetria (planImg)
CREATE TABLE struttura_blobs (
  struttura_id TEXT NOT NULL REFERENCES strutture(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('logo','planPdf','planImg')),
  data         TEXT NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (struttura_id, kind)
);

-- Cronologia: una riga per ogni salvataggio (dati senza binari), per confronto e ripristino
CREATE TABLE struttura_history (
  id           BIGSERIAL PRIMARY KEY,
  struttura_id TEXT NOT NULL,
  version      INT NOT NULL,
  data         JSONB NOT NULL,
  user_id      INT,
  user_name    TEXT,
  note         TEXT,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX struttura_history_sid ON struttura_history (struttura_id, at DESC);

-- Sedi assegnate a un utente (vuoto = tutte)
CREATE TABLE user_strutture (
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  struttura_id TEXT NOT NULL REFERENCES strutture(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, struttura_id)
);

CREATE TABLE audit_log (
  id        BIGSERIAL PRIMARY KEY,
  user_id   INT,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  data      JSONB,
  ip        TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at ON audit_log (at DESC);

CREATE TABLE "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");
