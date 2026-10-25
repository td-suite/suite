-- Toscana Diagnostica · Business
-- Schema iniziale: utenti, anagrafica partner B2B, contratti (Punti Prelievo, Service di Laboratorio, Medicina del Lavoro),
-- documenti, credenziali portali, fascicolo di autorizzazione sanitaria dei punti prelievo

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

-- Utenti: Superamministratore, Service Manager, Retail Manager (punti prelievo), MDL Manager, HQS Manager (fascicoli), Consultazione
CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  title                TEXT,
  role                 TEXT NOT NULL CHECK (role IN ('ADMIN','SERVICE','RETAIL','MDL','HQS','VIEWER')),
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

-- Protocollo progressivo per tipo e anno (PP-2026-0001, SRV-2026-0001, MDL-2026-0001)
CREATE TABLE protocol_counters (
  kind TEXT NOT NULL,
  year INT NOT NULL,
  last INT NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, year)
);

-- Anagrafica clienti e partner B2B (TD-SGI-MOD173)
CREATE TABLE partners (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,                 -- ragione sociale
  vat              TEXT,                          -- partita IVA
  tax_code         TEXT,                          -- codice fiscale
  sdi              TEXT,
  street           TEXT,
  zip              TEXT,
  city             TEXT,
  prov             TEXT,
  country          TEXT NOT NULL DEFAULT 'Italia',
  email            TEXT,
  phone            TEXT,
  pec              TEXT,
  legal_rep        TEXT,                          -- legale rappresentante
  signer           TEXT,                          -- firmatario del contratto (se diverso)
  signer_role      TEXT,                          -- qualifica del firmatario
  contract_services TEXT,                         -- "Servizi a contratto"
  lab_reference    TEXT,                          -- laboratorio di riferimento
  billing_ref      TEXT,                          -- riferimento fatturazione
  svc_contact      TEXT, svc_email TEXT, svc_mobile TEXT, svc_address TEXT,      -- riferimenti per la gestione del servizio
  proc_contact     TEXT, proc_email TEXT, proc_mobile TEXT, proc_address TEXT,   -- riferimenti per l'approvvigionamento
  pay_method       TEXT,
  pay_terms        TEXT,
  currency         TEXT NOT NULL DEFAULT 'EUR',
  withholding      BOOLEAN NOT NULL DEFAULT FALSE,
  vat_territoriality TEXT,
  intent_declaration TEXT,
  split_payment    BOOLEAN NOT NULL DEFAULT FALSE,
  tax_values       TEXT,
  bank_name        TEXT,
  iban             TEXT,
  notes            TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       INT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX partners_name_idx ON partners (lower(name));
CREATE INDEX partners_vat_idx ON partners (vat);

-- Contratti: PP = punto prelievi (appalto con la struttura ospitante), SRV = service di laboratorio, MDL = medicina del lavoro
CREATE TABLE contracts (
  id             SERIAL PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('PP','SRV','MDL','SEDE')),
  protocol       TEXT UNIQUE,
  status         TEXT NOT NULL DEFAULT 'BOZZA' CHECK (status IN ('BOZZA','PROPOSTA','FIRMATO','AUTORIZZATO','ATTIVO','CESSATO','ANNULLATO')),
  partner_id     INT NOT NULL REFERENCES partners(id),
  title          TEXT,                                      -- denominazione breve (es. "Punto Prelievi Calenzano")
  proposal_date  DATE NOT NULL,
  start_date     DATE,
  end_date       DATE,
  data           JSONB NOT NULL DEFAULT '{}'::jsonb,         -- campi specifici della sezione
  notes          TEXT,
  signed_at      DATE,                                      -- data di sottoscrizione con il partner
  version        INT NOT NULL DEFAULT 1,                    -- cresce a ogni rigenerazione del documento
  created_by     INT NOT NULL REFERENCES users(id),
  cancelled_at   TIMESTAMPTZ,
  cancel_reason  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contracts_kind_status_idx ON contracts (kind, status);
CREATE INDEX contracts_partner_idx ON contracts (partner_id);

-- File del contratto: documento generato (DOCX/PDF), contratto firmato, listini, altro
CREATE TABLE contract_files (
  id          SERIAL PRIMARY KEY,
  contract_id INT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  category    TEXT NOT NULL CHECK (category IN ('GENERATO_DOCX','GENERATO_PDF','FIRMATO','LISTINO_XLSX','LISTINO_PDF','PLANIMETRIA','ASSICURAZIONE','ALTRO')),
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INT NOT NULL,
  sha256      TEXT NOT NULL,
  data        BYTEA NOT NULL,
  version     INT,
  uploaded_by INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contract_files_contract_idx ON contract_files (contract_id);

-- Credenziali di accesso al portale consegnate al cliente (password cifrata AES-256-GCM)
CREATE TABLE portal_credentials (
  contract_id  INT PRIMARY KEY REFERENCES contracts(id) ON DELETE CASCADE,
  portal_url   TEXT,
  username     TEXT,
  password_enc TEXT,
  notes        TEXT,
  updated_by   INT REFERENCES users(id),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cronologia del contratto
CREATE TABLE contract_events (
  id          BIGSERIAL PRIMARY KEY,
  contract_id INT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  user_id     INT REFERENCES users(id),
  note        TEXT,
  data        JSONB,
  at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX contract_events_idx ON contract_events (contract_id, at);

-- Fascicolo di autorizzazione sanitaria (L.R. Toscana 51/2009): uno per contratto PP e per sede TD in locazione
CREATE TABLE dossiers (
  id              SERIAL PRIMARY KEY,
  contract_id     INT NOT NULL UNIQUE REFERENCES contracts(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'IN_CORSO' CHECK (status IN ('IN_CORSO','PRESENTATO','AUTORIZZATO')),
  doc_date        DATE,                                     -- data dei documenti generati
  hours           JSONB NOT NULL DEFAULT '[]'::jsonb,        -- orari per giorno (prelievo, ritiro referti)
  staff           JSONB NOT NULL DEFAULT '[]'::jsonb,        -- elenco del personale
  equipment       JSONB NOT NULL DEFAULT '[]'::jsonb,        -- elenco della strumentazione
  checklists      JSONB NOT NULL DEFAULT '[]'::jsonb,        -- liste di autovalutazione A, B, B1.1 con risposte
  doc_state       JSONB NOT NULL DEFAULT '{}'::jsonb,        -- per documento: non applicabile, note
  extra           JSONB NOT NULL DEFAULT '{}'::jsonb,        -- piano, tipologia immobile, addetti, codici DVR/DUVRI, note
  submitted_at    DATE,
  authorized_at   DATE,
  authorization_ref TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- File del fascicolo: generati dall'app o caricati, per documento (doc_key dal catalogo in lib/dossier.js)
CREATE TABLE dossier_files (
  id          SERIAL PRIMARY KEY,
  dossier_id  INT NOT NULL REFERENCES dossiers(id) ON DELETE CASCADE,
  doc_key     TEXT NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('GEN','UPLOAD')),
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INT NOT NULL,
  sha256      TEXT NOT NULL,
  data        BYTEA NOT NULL,
  label       TEXT,
  uploaded_by INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX dossier_files_idx ON dossier_files (dossier_id, doc_key);
