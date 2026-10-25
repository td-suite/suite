-- Toscana Diagnostica · Contracts (HR document management)
-- Schema iniziale

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

-- Utenti dell'applicazione
CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('ADMIN','HR','VIEWER')),
  auth_provider        TEXT NOT NULL DEFAULT 'LOCAL' CHECK (auth_provider IN ('LOCAL','ENTRA','BOTH')),
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

-- Aree aziendali
CREATE TABLE areas (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL UNIQUE,
  sort_order INT NOT NULL DEFAULT 100,
  active     BOOLEAN NOT NULL DEFAULT TRUE
);

-- Sedi di lavoro
CREATE TABLE work_sites (
  id      SERIAL PRIMARY KEY,
  name    TEXT NOT NULL,
  address TEXT NOT NULL,
  active  BOOLEAN NOT NULL DEFAULT TRUE
);

-- Risorse: dipendenti, liberi professionisti, candidati
CREATE TABLE resources (
  id              SERIAL PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('DIPENDENTE','LP')),
  status          TEXT NOT NULL DEFAULT 'ATTIVO' CHECK (status IN ('CANDIDATO','IMPEGNO','ATTIVO','CESSATO')),
  last_name       TEXT NOT NULL,
  first_name      TEXT NOT NULL,
  sex             TEXT CHECK (sex IN ('F','M')),
  title           TEXT,                       -- dott., dott.ssa, prof., avv.
  birth_place     TEXT,
  birth_date      DATE,
  tax_code        TEXT,
  vat_number      TEXT,
  phone           TEXT,
  email           TEXT,
  address         TEXT,                       -- via e civico
  zip             TEXT,
  city            TEXT,
  province        TEXT,
  area_id         INT REFERENCES areas(id),
  manager_id      INT REFERENCES resources(id),
  notes           TEXT,
  cv_attachment_id INT,                       -- riferimento all'allegato CV (dossier)
  hired_at        DATE,                       -- data assunzione / inizio incarico
  terminated_at   DATE,
  created_by      INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX resources_name_idx ON resources (last_name, first_name);
CREATE UNIQUE INDEX resources_cf_uq ON resources (upper(tax_code)) WHERE tax_code IS NOT NULL AND tax_code <> '';

-- Rapporto di lavoro subordinato (una riga per dipendente; storico via versioni documento)
CREATE TABLE employments (
  resource_id        INT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  contract_type      TEXT NOT NULL DEFAULT 'TIND' CHECK (contract_type IN ('TIND','TDET','APPRENDISTATO','DIRIGENTE')),
  ccnl               TEXT NOT NULL DEFAULT 'STUDI_PROFESSIONALI',
  level              TEXT,                    -- Q, 1, 2, 3S, 3, 4S, 4, 5 (o DIRIGENTE)
  qualification      TEXT,                    -- Quadro, Impiegato, Apprendista, Dirigente
  job_title          TEXT,                    -- mansione
  weekly_hours       NUMERIC(5,2) NOT NULL DEFAULT 40,
  weekly_days        INT NOT NULL DEFAULT 5,
  days_label         TEXT NOT NULL DEFAULT 'dal lunedì al venerdì',
  autonomous_hours   BOOLEAN NOT NULL DEFAULT FALSE, -- clausola D.Lgs. 66/2003
  ral                NUMERIC(12,2) NOT NULL DEFAULT 0,
  monthly_payments   INT NOT NULL DEFAULT 14,
  base_pay           NUMERIC(12,2),           -- paga base (minimo tabellare)
  superminimo        NUMERIC(12,2),
  superminimo_absorbable BOOLEAN NOT NULL DEFAULT TRUE,
  function_allowance NUMERIC(12,2),           -- indennità di funzione
  start_date         DATE,
  end_date           DATE,                    -- per TDET / fine apprendistato
  probation          TEXT NOT NULL DEFAULT 'Nessuno.',
  probation_days     INT,
  probation_end      DATE,
  work_site          TEXT,
  benefits           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ["PC portatile aziendale", ...]
  smart_working      BOOLEAN NOT NULL DEFAULT FALSE,
  mbo_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  mbo_pct            NUMERIC(5,2),
  mbo_year           INT,
  mbo_objectives     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{area,objective,kpi,target,weight}]
  mbo_individual     TEXT,
  ral_steps          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{from:'2027-01-01', ral: 42000}]
  cost_coefficient   NUMERIC(6,4),            -- override del coefficiente costo azienda
  letter_date        DATE,
  exit_fee           BOOLEAN NOT NULL DEFAULT FALSE,
  unilav_ref         TEXT,
  notes              TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Incarico libero professionale
CREATE TABLE lp_contracts (
  resource_id        INT PRIMARY KEY REFERENCES resources(id) ON DELETE CASCADE,
  discipline         TEXT,                    -- disciplina / specialità
  role_description   TEXT,                    -- oggetto della prestazione
  activities         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- elenco attività (facoltativo)
  degrees            JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ["Laurea in ... conseguita presso ... in data ..."]
  order_name         TEXT,                    -- Ordine dei Medici / Biologi / Infermieri
  order_province     TEXT,
  order_number       TEXT,
  order_since        DATE,
  insurance_required NUMERIC(14,2),           -- massimale polizza RC richiesto
  insurance_company  TEXT,
  insurance_policy   TEXT,
  insurance_expiry   DATE,
  start_date         DATE,
  end_date           DATE,
  auto_renew         BOOLEAN NOT NULL DEFAULT TRUE,
  notice_days        INT NOT NULL DEFAULT 30,
  fees               JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- [{type:'FISSO'|'ORARIO'|'PRESTAZIONE'|'VARIABILE', description, category, amount, unit:'mese'|'ora'|'cad'|'%', notes}]
  est_monthly_cost   NUMERIC(12,2),           -- stima costo mensile (default: somma fissi)
  vat_regime         TEXT,                    -- es. "esente art.10", "22%", "cassa 4%"
  letter_date        DATE,
  notes              TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lettere di impegno all'assunzione
CREATE TABLE commitment_letters (
  id                 SERIAL PRIMARY KEY,
  resource_id        INT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'BOZZA' CHECK (status IN ('BOZZA','INVIATA','ACCETTATA','RIFIUTATA','SCADUTA','CONVERTITA')),
  letter_date        DATE NOT NULL DEFAULT CURRENT_DATE,
  start_by           DATE,                    -- "comunque non oltre il"
  valid_until        DATE,                    -- validità della proposta
  level              TEXT,
  qualification      TEXT,
  job_title          TEXT,
  weekly_hours       NUMERIC(5,2) NOT NULL DEFAULT 40,
  autonomous_hours   BOOLEAN NOT NULL DEFAULT FALSE,
  ral                NUMERIC(12,2) NOT NULL DEFAULT 0,
  ral_steps          JSONB NOT NULL DEFAULT '[]'::jsonb,
  mbo_enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  mbo_pct            NUMERIC(5,2),
  work_site          TEXT,
  contract_type      TEXT NOT NULL DEFAULT 'TIND',
  accepted_at        DATE,
  notes              TEXT,
  created_by         INT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX commitment_letters_res_idx ON commitment_letters (resource_id);

-- Documenti generati dall'applicazione (DOCX + PDF), versionati
CREATE TABLE generated_documents (
  id            SERIAL PRIMARY KEY,
  resource_id   INT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('CONTRATTO','MBO','LETTERA_IMPEGNO','CONTRATTO_LP','APPRENDISTATO')),
  ref_id        INT,                          -- es. id lettera di impegno
  version       INT NOT NULL DEFAULT 1,
  title         TEXT NOT NULL,
  docx          BYTEA,
  pdf           BYTEA,
  data          JSONB,                        -- dati usati per la generazione
  generated_by  INT REFERENCES users(id),
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX generated_documents_res_idx ON generated_documents (resource_id, kind);

-- Dossier: allegati per risorsa con eventuale scadenza
CREATE TABLE attachments (
  id            SERIAL PRIMARY KEY,
  resource_id   INT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  category      TEXT NOT NULL,
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL,
  size          INT NOT NULL,
  data          BYTEA NOT NULL,
  sha256        TEXT,
  issued_at     DATE,
  expires_at    DATE,
  signed        BOOLEAN NOT NULL DEFAULT FALSE,
  notes         TEXT,
  uploaded_by   INT REFERENCES users(id),
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX attachments_res_idx ON attachments (resource_id);
CREATE INDEX attachments_exp_idx ON attachments (expires_at) WHERE expires_at IS NOT NULL;

-- Checklist documentale per tipologia di risorsa (quali documenti ci si aspetta nel dossier)
CREATE TABLE dossier_requirements (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('DIPENDENTE','LP')),
  category    TEXT NOT NULL,
  label       TEXT NOT NULL,
  required    BOOLEAN NOT NULL DEFAULT TRUE,
  renew_months INT,                            -- periodicità attesa (es. 12 per iscrizione albo, 36 per ECM)
  sort_order  INT NOT NULL DEFAULT 100,
  UNIQUE (kind, category)
);

-- Scadenze manuali (oltre a quelle calcolate dai documenti e dai contratti)
CREATE TABLE deadlines (
  id           SERIAL PRIMARY KEY,
  resource_id  INT REFERENCES resources(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  due_date     DATE NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'MANUALE',
  done         BOOLEAN NOT NULL DEFAULT FALSE,
  notes        TEXT,
  created_by   INT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CV Box (scouting)
CREATE TABLE cv_box (
  id            SERIAL PRIMARY KEY,
  last_name     TEXT,
  first_name    TEXT,
  email         TEXT,
  phone         TEXT,
  area_id       INT REFERENCES areas(id),
  role_target   TEXT,
  summary       TEXT,
  rating        INT CHECK (rating BETWEEN 1 AND 5),
  status        TEXT NOT NULL DEFAULT 'NUOVO' CHECK (status IN ('NUOVO','IN_VALUTAZIONE','COLLOQUIO','IN_ATTESA','SCARTATO','CONVERTITO')),
  source        TEXT,
  filename      TEXT,
  mime          TEXT,
  size          INT,
  data          BYTEA,
  text_excerpt  TEXT,
  resource_id   INT REFERENCES resources(id),
  received_at   DATE NOT NULL DEFAULT CURRENT_DATE,
  uploaded_by   INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CCNL: livelli e minimi tabellari
CREATE TABLE ccnl_levels (
  id          SERIAL PRIMARY KEY,
  ccnl        TEXT NOT NULL DEFAULT 'STUDI_PROFESSIONALI',
  level       TEXT NOT NULL,
  description TEXT,
  sort_order  INT NOT NULL DEFAULT 100,
  probation_days INT,
  UNIQUE (ccnl, level)
);
CREATE TABLE ccnl_minimums (
  id         SERIAL PRIMARY KEY,
  level_id   INT NOT NULL REFERENCES ccnl_levels(id) ON DELETE CASCADE,
  valid_from DATE NOT NULL,
  amount     NUMERIC(10,2) NOT NULL,
  enac       NUMERIC(10,2),
  UNIQUE (level_id, valid_from)
);
-- Paragrafi di sintesi del CCNL (modificabili dall'amministratore)
CREATE TABLE ccnl_sections (
  id         SERIAL PRIMARY KEY,
  ccnl       TEXT NOT NULL DEFAULT 'STUDI_PROFESSIONALI',
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 100,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Documenti CCNL (PDF del contratto, accordo integrativo)
CREATE TABLE ccnl_documents (
  id          SERIAL PRIMARY KEY,
  ccnl        TEXT NOT NULL DEFAULT 'STUDI_PROFESSIONALI',
  title       TEXT NOT NULL,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INT NOT NULL,
  data        BYTEA NOT NULL,
  uploaded_by INT REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE resources ADD CONSTRAINT resources_cv_fk FOREIGN KEY (cv_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL;
