-- td-integration · schema iniziale
-- Piano di integrazione post-closing: target, attività, team, utenti, audit, snapshot, sessioni.

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Utenti dell'applicazione. L'accesso con Microsoft 365 è multi-tenant: ogni utente viene
-- censito al primo login (stato PENDING) e abilitato da un amministratore, salvo i domini auto-abilitati.
CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  role                 TEXT NOT NULL DEFAULT 'VIEWER' CHECK (role IN ('ADMIN','EDITOR','VIEWER')),
  status               TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('ACTIVE','PENDING','DISABLED')),
  auth_provider        TEXT NOT NULL DEFAULT 'ENTRA' CHECK (auth_provider IN ('LOCAL','ENTRA','BOTH')),
  organization         TEXT,                       -- es. "Toscana Diagnostica", "Banca X", "Investitore Y"
  entra_tid            TEXT,                       -- tenant Microsoft di provenienza
  entra_oid            TEXT,
  password_hash        TEXT,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  failed_logins        INT NOT NULL DEFAULT 0,
  locked_until         TIMESTAMPTZ,
  last_login_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

-- Società target del piano
CREATE TABLE targets (
  id         TEXT PRIMARY KEY,
  position   INT NOT NULL DEFAULT 0,
  nome       TEXT NOT NULL DEFAULT '',
  rs         TEXT NOT NULL DEFAULT '',
  ind        TEXT NOT NULL DEFAULT '',
  piva       TEXT NOT NULL DEFAULT '',
  ref        TEXT NOT NULL DEFAULT '',
  tel        TEXT NOT NULL DEFAULT '',
  mail       TEXT NOT NULL DEFAULT '',
  web        TEXT NOT NULL DEFAULT '',
  pec        TEXT NOT NULL DEFAULT '',
  fatt       TEXT NOT NULL DEFAULT '',   -- numerico o stringa vuota (come nell'app originale)
  pfn        TEXT NOT NULL DEFAULT '',
  ev         TEXT NOT NULL DEFAULT '',
  linee      JSONB NOT NULL DEFAULT '[]'::jsonb,
  loi        TEXT NOT NULL DEFAULT '',
  prelim     TEXT NOT NULL DEFAULT '',
  closing    TEXT NOT NULL DEFAULT '',
  hor        INT NOT NULL DEFAULT 24,
  lm         BIGINT NOT NULL DEFAULT 0,  -- last-modified lato client (ms epoch), compatibilità merge
  version    INT NOT NULL DEFAULT 1,
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Attività del GANTT (chiave composta: l'id è univoco dentro la target)
CREATE TABLE activities (
  target_id  TEXT NOT NULL REFERENCES targets(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  position   INT NOT NULL DEFAULT 0,
  cid        TEXT NOT NULL DEFAULT '',   -- codice catalogo (G1, O2, 1.1 ...) o 'nuova'
  nome       JSONB,                      -- null (nome da catalogo), stringa, oppure {it,en}
  proc       TEXT NOT NULL DEFAULT 'ops',
  sw         INT NOT NULL DEFAULT 0,
  ew         INT NOT NULL DEFAULT 0,
  owner      TEXT NOT NULL DEFAULT '',
  support    JSONB NOT NULL DEFAULT '[]'::jsonb,
  dett       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  st         INT NOT NULL DEFAULT 0 CHECK (st BETWEEN 0 AND 3),
  pl         BOOLEAN NOT NULL DEFAULT FALSE,
  ms         BOOLEAN NOT NULL DEFAULT FALSE,
  fine       TEXT NOT NULL DEFAULT '',
  lm         BIGINT NOT NULL DEFAULT 0,
  version    INT NOT NULL DEFAULT 1,
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target_id, id)
);
CREATE INDEX activities_target_pos_idx ON activities (target_id, position);

-- Registro ruoli / owner
CREATE TABLE team (
  id       SERIAL PRIMARY KEY,
  position INT NOT NULL DEFAULT 0,
  r        TEXT NOT NULL DEFAULT '',   -- ruolo (es. CEO)
  f        TEXT NOT NULL DEFAULT 'Interna',
  n        TEXT NOT NULL DEFAULT '',   -- nome
  lm       BIGINT NOT NULL DEFAULT 0
);

-- Registro attività: chi ha fatto cosa, con prima/dopo
CREATE TABLE audit_log (
  id        BIGSERIAL PRIMARY KEY,
  user_id   INT,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  target_id TEXT,
  label     TEXT,
  data      JSONB,
  ip        TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

-- Fotografie integrali del piano (giornaliere e prima delle operazioni massive)
CREATE TABLE snapshots (
  id         SERIAL PRIMARY KEY,
  kind       TEXT NOT NULL DEFAULT 'manual',   -- manual | daily | pre-import | pre-restore | migration
  note       TEXT,
  data       JSONB NOT NULL,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX snapshots_at_idx ON snapshots (created_at DESC);

-- Sessioni (connect-pg-simple)
CREATE TABLE "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");
