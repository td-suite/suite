-- Toscana Diagnostica · Shipments
-- Schema iniziale: kit, richieste, spedizioni, campioni, rendicontazione

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Utenti. Ruoli: SUPERADMIN, ADMIN (operativo), VIEWER (Amministrazione, sola lettura), ENDEAVOR (partner, sola lettura dei rendiconti Endeavor)
CREATE TABLE users (
  id                   SERIAL PRIMARY KEY,
  email                TEXT NOT NULL,
  full_name            TEXT NOT NULL,
  role                 TEXT NOT NULL CHECK (role IN ('SUPERADMIN','ADMIN','VIEWER','ENDEAVOR')),
  lang                 TEXT NOT NULL DEFAULT 'it' CHECK (lang IN ('it','en')),
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

CREATE TABLE "session" (
  "sid"    VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
  "sess"   JSON NOT NULL,
  "expire" TIMESTAMP(6) NOT NULL
);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");

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
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

-- Tipi di kit (per ora un solo tipo generico; estendibile)
CREATE TABLE kit_types (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO kit_types (name) VALUES ('Kit standard');

-- Lotti di carico a magazzino (una ricezione da fornitore)
CREATE TABLE stock_lots (
  id          SERIAL PRIMARY KEY,
  project     TEXT NOT NULL CHECK (project IN ('ENDEAVOR','LIFESTYLE')),
  supplier    TEXT NOT NULL DEFAULT 'Endeavor DNA',
  received_at DATE NOT NULL,
  reference   TEXT,
  notes       TEXT,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Modalità di spedizione (tariffario). outbound/return: STANDARD, EXPRESS o NULL (tratta non prevista)
CREATE TABLE shipping_modes (
  id               SERIAL PRIMARY KEY,
  project          TEXT NOT NULL DEFAULT 'ENDEAVOR' CHECK (project IN ('ENDEAVOR','LIFESTYLE')),
  code             TEXT NOT NULL UNIQUE,
  name_it          TEXT NOT NULL,
  name_en          TEXT NOT NULL,
  outbound_service TEXT CHECK (outbound_service IN ('STANDARD','EXPRESS')),
  return_service   TEXT CHECK (return_service IN ('STANDARD','EXPRESS')),
  price            NUMERIC(10,2) NOT NULL DEFAULT 0,
  email_aliases    TEXT,          -- frasi riconosciute nelle email, separate da |
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort             INT NOT NULL DEFAULT 0
);
INSERT INTO shipping_modes (code, name_it, name_en, outbound_service, return_service, price, email_aliases, sort) VALUES
 ('STD_OUT',         'Standard in andata',                     'Standard outbound',                  'STANDARD', NULL,       6.80,  'standard sda|standard outbound|standard andata|standard in andata|standard only|standard', 10),
 ('STD_RET',         'Standard in ritorno',                    'Standard return',                    NULL,       'STANDARD', 6.80,  'standard return sda|standard return|standard ritorno|standard in ritorno|standard return only', 20),
 ('STD_OUT_STD_RET', 'Standard in andata e ritorno',           'Standard outbound and return',       'STANDARD', 'STANDARD', 13.60, 'standard outbound and return|standard return and outbound|standard outbound + return|standard andata e ritorno|standard a/r|standard both ways|standard round trip', 30),
 ('STD_OUT_EXP_RET', 'Standard in andata e Express in ritorno','Standard outbound and Express return','STANDARD', 'EXPRESS',  16.70, 'standard outbound express return|standard andata express ritorno|standard + express|standard/express', 40),
 ('EXP_OUT',         'Express in andata',                      'Express outbound',                   'EXPRESS',  NULL,       9.90,  'express sda|express outbound|express andata|express in andata|express only|express', 50),
 ('EXP_RET',         'Express in ritorno',                     'Express return',                     NULL,       'EXPRESS',  9.90,  'express return sda|express return|express ritorno|express in ritorno|express return only', 60),
 ('EXP_OUT_EXP_RET', 'Express in andata e ritorno',            'Express outbound and return',        'EXPRESS',  'EXPRESS',  19.80, 'express outbound and return|express return and outbound|express outbound + return|express andata e ritorno|express a/r|express both ways|express round trip', 70);

-- Email ricevute nella casella shipments@ (o incollate a mano)
CREATE TABLE inbox_messages (
  id           SERIAL PRIMARY KEY,
  graph_id     TEXT UNIQUE,
  source       TEXT NOT NULL DEFAULT 'GRAPH' CHECK (source IN ('GRAPH','PASTE')),
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_addr    TEXT,
  subject      TEXT,
  body_text    TEXT,
  parsed       JSONB,
  status       TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','PARSED','CONFIRMED','IGNORED','ERROR')),
  error        TEXT,
  order_ids    INT[] NOT NULL DEFAULT '{}',
  processed_by INT REFERENCES users(id),
  processed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX inbox_status_idx ON inbox_messages (status, received_at DESC);

-- Kit fisici identificati dal codice a barre
CREATE TABLE kits (
  id            SERIAL PRIMARY KEY,
  barcode       TEXT NOT NULL,
  lot_id        INT REFERENCES stock_lots(id),
  kit_type_id   INT REFERENCES kit_types(id),
  project       TEXT NOT NULL CHECK (project IN ('ENDEAVOR','LIFESTYLE')),
  status        TEXT NOT NULL DEFAULT 'IN_STOCK' CHECK (status IN ('IN_STOCK','ASSIGNED','SHIPPED','DELIVERED','SAMPLE_RECEIVED','SHIPPED_TO_LAB','CLOSED','DISCARDED')),
  order_id      INT,
  notes         TEXT,
  discard_reason TEXT,
  created_by    INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX kits_barcode_uq ON kits (upper(barcode));
CREATE INDEX kits_status_idx ON kits (project, status);

-- Spedizione verso il laboratorio (FedEx, una lettera di vettura, uno o più kit)
CREATE TABLE lab_shipments (
  id                   SERIAL PRIMARY KEY,
  project              TEXT NOT NULL DEFAULT 'ENDEAVOR',
  awb_number           TEXT,
  awb_received_at      DATE,
  awb_file             BYTEA,
  awb_file_name        TEXT,
  awb_file_mime        TEXT,
  status               TEXT NOT NULL DEFAULT 'PREPARING' CHECK (status IN ('PREPARING','SHIPPED','DELIVERED')),
  shipped_at           TIMESTAMPTZ,
  delivered_at         TIMESTAMPTZ,
  notification_sent_at TIMESTAMPTZ,
  notes                TEXT,
  created_by           INT REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Periodi di fatturazione (rendiconto economico mensile)
CREATE TABLE billing_periods (
  id             SERIAL PRIMARY KEY,
  project        TEXT NOT NULL DEFAULT 'ENDEAVOR',
  month          TEXT NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','INVOICED')),
  closed_at      TIMESTAMPTZ,
  closed_by      INT REFERENCES users(id),
  invoice_ref    TEXT,
  invoice_date   DATE,
  total_shipping NUMERIC(12,2),
  total_samples  NUMERIC(12,2),
  totals         JSONB,
  notes          TEXT,
  UNIQUE (project, month)
);

-- Richieste (una per kit da spedire / paziente)
CREATE TABLE orders (
  id                 SERIAL PRIMARY KEY,
  project            TEXT NOT NULL CHECK (project IN ('ENDEAVOR','LIFESTYLE')),
  order_type         TEXT NOT NULL CHECK (order_type IN ('ENDEAVOR','KIT_ONLY','KIT_AND_EXAM')),
  external_ref       TEXT,                       -- es. AFF298672IT, numero ordine e-commerce
  shipping_mode_id   INT REFERENCES shipping_modes(id),
  patient_title      TEXT,
  patient_first_name TEXT NOT NULL,
  patient_last_name  TEXT NOT NULL,
  address1           TEXT NOT NULL,
  address2           TEXT,
  city               TEXT NOT NULL,
  province           TEXT,
  zip                TEXT,
  country            TEXT NOT NULL DEFAULT 'Italia',
  phone              TEXT,
  email              TEXT,
  lang               TEXT NOT NULL DEFAULT 'it' CHECK (lang IN ('it','en')),
  notes              TEXT,
  source             TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','EMAIL')),
  inbox_message_id   INT REFERENCES inbox_messages(id),
  kit_id             INT REFERENCES kits(id),
  status             TEXT NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','ASSIGNED','SHIPPED','DELIVERED','SAMPLE_RECEIVED','SHIPPED_TO_LAB','CLOSED','CANCELLED')),
  handover           BOOLEAN NOT NULL DEFAULT FALSE, -- kit consegnato a mano (nessuna tratta di andata)
  assigned_at        TIMESTAMPTZ,
  shipped_at         TIMESTAMPTZ,
  delivered_at       TIMESTAMPTZ,
  sample_received_at TIMESTAMPTZ,
  sample_received_site TEXT,
  lab_shipment_id    INT REFERENCES lab_shipments(id),
  closed_at          TIMESTAMPTZ,
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      TEXT,
  fee_shipping       NUMERIC(10,2),
  fee_shipping_date  DATE,
  fee_sample         NUMERIC(10,2),
  fee_sample_date    DATE,
  ship_billing_period_id   INT REFERENCES billing_periods(id),
  sample_billing_period_id INT REFERENCES billing_periods(id),
  anonymized_at      TIMESTAMPTZ,
  created_by         INT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX orders_status_idx ON orders (project, status);
CREATE INDEX orders_ref_idx ON orders (upper(external_ref));
ALTER TABLE kits ADD CONSTRAINT kits_order_fk FOREIGN KEY (order_id) REFERENCES orders(id);

-- Spedizioni (tratte): andata al paziente, ritorno del campione, laboratorio
CREATE TABLE shipments (
  id               SERIAL PRIMARY KEY,
  order_id         INT REFERENCES orders(id),
  lab_shipment_id  INT REFERENCES lab_shipments(id),
  direction        TEXT NOT NULL CHECK (direction IN ('OUTBOUND','RETURN','LAB')),
  carrier          TEXT NOT NULL DEFAULT 'SDA' CHECK (carrier IN ('SDA','FEDEX','OTHER')),
  service          TEXT CHECK (service IN ('STANDARD','EXPRESS')),
  tracking_number  TEXT,
  label_printed_at TIMESTAMPTZ,
  shipped_at       TIMESTAMPTZ,
  delivered_at     TIMESTAMPTZ,
  last_status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (last_status IN ('PENDING','IN_TRANSIT','OUT_FOR_DELIVERY','DELIVERED','EXCEPTION','UNKNOWN')),
  last_status_text TEXT,
  last_event_at    TIMESTAMPTZ,
  last_checked_at  TIMESTAMPTZ,
  check_error      TEXT,
  events           JSONB NOT NULL DEFAULT '[]',
  provider_registered BOOLEAN NOT NULL DEFAULT FALSE,
  created_by       INT REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shipments_open_idx ON shipments (last_status) WHERE tracking_number IS NOT NULL AND last_status NOT IN ('DELIVERED');
CREATE INDEX shipments_order_idx ON shipments (order_id);

-- Cronologia eventi per richiesta / kit
CREATE TABLE order_events (
  id       BIGSERIAL PRIMARY KEY,
  order_id INT REFERENCES orders(id),
  kit_id   INT REFERENCES kits(id),
  event    TEXT NOT NULL,
  data     JSONB,
  user_id  INT,
  at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX order_events_order_idx ON order_events (order_id, at);

-- Registro email inviate
CREATE TABLE email_log (
  id              SERIAL PRIMARY KEY,
  kind            TEXT NOT NULL,
  ref_key         TEXT,
  order_id        INT,
  to_addr         TEXT NOT NULL,
  cc_addr         TEXT,
  subject         TEXT NOT NULL,
  body            TEXT,
  attachment_name TEXT,
  status          TEXT NOT NULL CHECK (status IN ('INVIATA','FALLITA','NON_CONFIGURATA','DUPLICATA')),
  error           TEXT,
  sent_by         INT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_log_ref_idx ON email_log (ref_key);

-- Impostazioni predefinite
INSERT INTO app_settings (key, value) VALUES
 ('sample_fee', '3.50'),
 ('billing_customer', 'Endeavor DNA Laboratories'),
 ('billing_customer_address', '500 South Main Street, Las Cruces NM 88001, United States of America'),
 ('affinity_notify_emails', 'katalin@affinitydna.co.uk, katie@easydna.com, stefano@affinitydna.co.uk'),
 ('affinity_sender_filter', 'affinitydna.co.uk, easydna.com'),
 ('lab_consignee', E'Endeavor DNA Laboratories\nAttn: Alonso Magallanes\n500 South Main Street\nLAS CRUCES NM 88001\nUNITED STATES OF AMERICA\nTel. (915) 519-1600\ninfo@affinitydna.co.uk'),
 ('return_address', E'Toscana Diagnostica S.r.l.\nVia di Pratignone, 13/4\n50019 Sesto Fiorentino (FI)\nItalia'),
 ('td_sites', 'Sesto Fiorentino, Calenzano, Montemurlo, Quarrata'),
 ('alert_return_days', '21'),
 ('alert_awb_days', '5'),
 ('alert_stock_min', '10'),
 ('notify_patient_on_ship', 'false'),
 ('notify_admins_email', ''),
 ('retention_months', '12'),
 ('inbox_enabled', 'true');
