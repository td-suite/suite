-- Toscana Diagnostica · Retail Dashboard (B2C + B2B)
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
  role                 TEXT NOT NULL CHECK (role IN ('ADMIN','RETAIL','SEDE','VIEWER')),
  site_id              INT,                       -- per il profilo SEDE: la sede di competenza
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

-- Sedi del network (punti prelievo, centri diagnostici, poliambulatori, laboratorio)
CREATE TABLE sites (
  id           SERIAL PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,           -- codice breve (es. FI-CEC, LI-LAM)
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'PUNTO_PRELIEVI' CHECK (kind IN ('LABORATORIO','CENTRO_DIAGNOSTICO','POLIAMBULATORIO','PUNTO_PRELIEVI','HEADQUARTER')),
  address      TEXT,
  city         TEXT,
  province     TEXT,
  zip          TEXT,
  lat          NUMERIC(9,6),
  lng          NUMERIC(9,6),
  manager      TEXT,                           -- site manager
  legacy_brand TEXT,                           -- insegna precedente (Biolabor, Labronica, CIFS, ...)
  phone        TEXT,
  email        TEXT,
  opening_hours TEXT,
  sqm_waiting  INT,                            -- mq sala d'attesa (per il book retail)
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order   INT NOT NULL DEFAULT 100,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE users ADD CONSTRAINT users_site_fk FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE SET NULL;

-- Linee di prodotto (per aggregare il catalogo)
CREATE TABLE product_lines (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,            -- LAB, IMG, SPEC, MDL, PAC
  name       TEXT NOT NULL,
  color      TEXT,
  sort_order INT NOT NULL DEFAULT 100
);

-- Catalogo prestazioni (dal tracciato GIPO / StudioLab)
CREATE TABLE products (
  id             SERIAL PRIMARY KEY,
  code           TEXT NOT NULL,               -- codice TD / GIPO (es. 0014, ECO012, MSPE003)
  description    TEXT NOT NULL,
  line_id        INT REFERENCES product_lines(id),
  specialty      TEXT,                        -- Specialita_descrizione (branca)
  nomenclature   TEXT,                        -- codice nomenclatore regionale
  price          NUMERIC(10,2),               -- listino privato
  price_ssn      NUMERIC(10,2),               -- tariffa SSN
  cost           NUMERIC(10,2),               -- costo di produzione
  duration_min   INT,
  is_package     BOOLEAN NOT NULL DEFAULT FALSE,
  periodicity_months INT,                     -- esami a richiamo periodico (es. 12 mammografia, 6 check-up)
  active         BOOLEAN NOT NULL DEFAULT TRUE,
  source         TEXT NOT NULL DEFAULT 'MANUALE', -- GIPO | STUDIOLAB | MANUALE
  external_id    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX products_code_uq ON products (upper(code));
CREATE INDEX products_line_idx ON products (line_id);

-- Clienti: pazienti privati (B2C) e aziende/strutture (B2B)
CREATE TABLE customers (
  id              SERIAL PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('B2C','B2B')),
  source          TEXT NOT NULL DEFAULT 'MANUALE' CHECK (source IN ('GIPO','TUOTEMPO','STUDIOLAB','MANUALE','IMPORT')),
  external_id     TEXT,                       -- id nel gestionale di origine
  -- B2C
  last_name       TEXT,
  first_name      TEXT,
  sex             TEXT CHECK (sex IN ('F','M')),
  birth_date      DATE,
  tax_code        TEXT,
  -- B2B
  company_name    TEXT,
  vat_number      TEXT,
  sector          TEXT,                       -- settore (es. manifatturiero, GDO, sanità, assicurazione)
  b2b_type        TEXT,                       -- AZIENDA (medicina del lavoro/welfare) | STRUTTURA (service) | LABORATORIO | ASSICURAZIONE | FONDO | MMG
  contact_name    TEXT,
  employees       INT,
  -- Comuni
  email           TEXT,
  phone           TEXT,
  address         TEXT,
  zip             TEXT,
  city            TEXT,
  province        TEXT,
  home_site_id    INT REFERENCES sites(id),   -- sede di riferimento (prima accettazione)
  acquisition_channel TEXT,                   -- WEB | TELEFONO | SPORTELLO | APP | MMG | CONVENZIONE | PASSAPAROLA | CAMPAGNA | ALTRO
  acquisition_campaign_id INT,
  marketing_consent BOOLEAN,
  first_visit     DATE,
  last_visit      DATE,
  visits          INT NOT NULL DEFAULT 0,
  revenue         NUMERIC(12,2) NOT NULL DEFAULT 0,
  tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX customers_name_idx ON customers (last_name, first_name);
CREATE INDEX customers_company_idx ON customers (company_name);
CREATE UNIQUE INDEX customers_cf_uq ON customers (upper(tax_code)) WHERE tax_code IS NOT NULL AND tax_code <> '';
CREATE UNIQUE INDEX customers_vat_uq ON customers (vat_number) WHERE vat_number IS NOT NULL AND vat_number <> '';
CREATE UNIQUE INDEX customers_ext_uq ON customers (source, external_id) WHERE external_id IS NOT NULL AND external_id <> '';
CREATE INDEX customers_geo_idx ON customers (province, city);

-- Campagne (marketing e comunicazione)
CREATE TABLE campaigns (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  channel       TEXT NOT NULL,                -- META | GOOGLE | SMS | EMAIL | AFFISSIONI | STAMPA | RADIO | MMG | EVENTO | PARTNER | INSTORE | ALTRO
  objective     TEXT,                         -- NOTORIETA | ACQUISIZIONE | RIATTIVAZIONE | UPSELL | B2B
  target_segment TEXT,
  start_date    DATE NOT NULL,
  end_date      DATE,
  budget        NUMERIC(12,2),
  spent         NUMERIC(12,2),
  promo_code    TEXT,                         -- codice usato in accettazione (collega le vendite)
  status        TEXT NOT NULL DEFAULT 'PIANIFICATA' CHECK (status IN ('PIANIFICATA','ATTIVA','CONCLUSA','SOSPESA')),
  impressions   INT,
  clicks        INT,
  leads         INT,
  bookings      INT,
  site_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,
  product_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  promotion_id  INT,
  notes         TEXT,
  created_by    INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX campaigns_dates_idx ON campaigns (start_date, end_date);
ALTER TABLE customers ADD CONSTRAINT customers_campaign_fk FOREIGN KEY (acquisition_campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL;

-- Calendario promozionale (promozioni mensilizzate su scala annuale)
CREATE TABLE promotions (
  id            SERIAL PRIMARY KEY,
  year          INT NOT NULL,
  month         INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  name          TEXT NOT NULL,
  theme         TEXT,                         -- tema del mese (es. prevenzione cardiovascolare)
  claim         TEXT,                         -- claim principale
  claim_short   TEXT,                         -- versione breve (social, SMS)
  body          TEXT,                         -- testo esteso / descrizione
  target        TEXT,                         -- segmento (es. donne 45-65, uomini over 50, aziende)
  channel_scope TEXT NOT NULL DEFAULT 'B2C' CHECK (channel_scope IN ('B2C','B2B','ENTRAMBI')),
  discount_type TEXT CHECK (discount_type IN ('PERCENTUALE','IMPORTO','PREZZO_FISSO','PACCHETTO','OMAGGIO','NESSUNO')),
  discount_value NUMERIC(10,2),
  bundle_price  NUMERIC(10,2),
  start_date    DATE,
  end_date      DATE,
  product_ids   JSONB NOT NULL DEFAULT '[]'::jsonb,
  site_ids      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- vuoto = tutte le sedi
  push_plan     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{channel, action, when, owner, done}]
  materials     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{type, format, status}] locandina, totem, social, sms, newsletter
  kpi_target    JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {bookings, revenue, new_customers}
  status        TEXT NOT NULL DEFAULT 'BOZZA' CHECK (status IN ('BOZZA','APPROVATA','ATTIVA','CONCLUSA','ANNULLATA')),
  promo_code    TEXT,
  notes         TEXT,
  created_by    INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX promotions_ym_idx ON promotions (year, month);
ALTER TABLE campaigns ADD CONSTRAINT campaigns_promotion_fk FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE SET NULL;

-- Vendite: righe di accettazione (B2C da GIPO/TuoTempo, B2B da StudioLab)
CREATE TABLE sales (
  id            BIGSERIAL PRIMARY KEY,
  source        TEXT NOT NULL CHECK (source IN ('GIPO','TUOTEMPO','STUDIOLAB','MANUALE','IMPORT','DEMO')),
  external_ref  TEXT,                         -- numero accettazione / fattura nel gestionale
  line_no       INT NOT NULL DEFAULT 1,
  sale_date     DATE NOT NULL,
  sale_time     TIME,
  customer_id   INT REFERENCES customers(id) ON DELETE SET NULL,
  b2b_customer_id INT REFERENCES customers(id) ON DELETE SET NULL,  -- per le prestazioni B2B: azienda/struttura committente
  site_id       INT REFERENCES sites(id),
  product_id    INT REFERENCES products(id),
  product_code  TEXT,                         -- conservato anche se il prodotto non è in catalogo
  product_desc  TEXT,
  quantity      INT NOT NULL DEFAULT 1,
  gross_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount      NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_kind  TEXT,                         -- PRIVATO | SSN | CONVENZIONE | ASSICURAZIONE | FONDO | AZIENDA
  booking_channel TEXT,                       -- WEB | TELEFONO | SPORTELLO | APP | TUOTEMPO | MMG | CUP | AZIENDA
  referrer      TEXT,                         -- medico prescrittore / MMG
  promo_code    TEXT,
  campaign_id   INT REFERENCES campaigns(id) ON DELETE SET NULL,
  promotion_id  INT REFERENCES promotions(id) ON DELETE SET NULL,
  import_batch_id INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sales_date_idx ON sales (sale_date);
CREATE INDEX sales_customer_idx ON sales (customer_id);
CREATE INDEX sales_site_idx ON sales (site_id, sale_date);
CREATE INDEX sales_product_idx ON sales (product_id, sale_date);
CREATE UNIQUE INDEX sales_ext_uq ON sales (source, external_ref, line_no) WHERE external_ref IS NOT NULL AND external_ref <> '';

-- Esposizione: book retail per sede
CREATE TABLE exposure_zones (
  id         SERIAL PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,            -- VETRINA, INGRESSO, ACCETTAZIONE, ATTESA, CORRIDOIO, BOX_PRELIEVO, MONITOR, TOTEM, ESTERNO, DIGITAL
  name       TEXT NOT NULL,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 100
);

-- Standard di esposizione (il "book" tipo per tipologia di sede)
CREATE TABLE exposure_standards (
  id          SERIAL PRIMARY KEY,
  site_kind   TEXT NOT NULL,                  -- tipologia di sede a cui si applica (o 'TUTTE')
  zone_id     INT NOT NULL REFERENCES exposure_zones(id) ON DELETE CASCADE,
  material    TEXT NOT NULL,                  -- es. Locandina A3 promo del mese
  format      TEXT,                           -- A3, A4, 70x100, roll-up, totem 32", monitor 43"
  quantity    INT NOT NULL DEFAULT 1,
  rule        TEXT,                           -- regola espositiva (es. "altezza occhi, sostituire entro il 1° del mese")
  mandatory   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 100
);

-- Esposizione effettiva per sede (book retail compilato)
CREATE TABLE exposure_items (
  id           SERIAL PRIMARY KEY,
  site_id      INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  zone_id      INT NOT NULL REFERENCES exposure_zones(id),
  standard_id  INT REFERENCES exposure_standards(id) ON DELETE SET NULL,
  material     TEXT NOT NULL,
  format       TEXT,
  quantity     INT NOT NULL DEFAULT 1,
  promotion_id INT REFERENCES promotions(id) ON DELETE SET NULL,
  content      TEXT,                          -- cosa c'è esposto (claim, promo, servizio)
  valid_from   DATE,
  valid_to     DATE,
  status       TEXT NOT NULL DEFAULT 'DA_INSTALLARE' CHECK (status IN ('DA_INSTALLARE','INSTALLATO','DA_SOSTITUIRE','RIMOSSO','NON_CONFORME')),
  checked_at   DATE,
  checked_by   TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX exposure_items_site_idx ON exposure_items (site_id);

-- Foto dell'esposizione (verifiche in sede)
CREATE TABLE exposure_photos (
  id          SERIAL PRIMARY KEY,
  site_id     INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  item_id     INT REFERENCES exposure_items(id) ON DELETE CASCADE,
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INT NOT NULL,
  data        BYTEA NOT NULL,
  taken_at    DATE NOT NULL DEFAULT CURRENT_DATE,
  uploaded_by INT REFERENCES users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Connettori verso i gestionali (GIPO, TuoTempo, StudioLab)
CREATE TABLE connectors (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL UNIQUE CHECK (kind IN ('GIPO','TUOTEMPO','STUDIOLAB')),
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  base_url    TEXT,
  auth_kind   TEXT NOT NULL DEFAULT 'API_KEY', -- API_KEY | BASIC | OAUTH2 | SFTP
  credentials TEXT,                            -- cifrate con SESSION_SECRET (AES-256-GCM)
  settings    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- es. {instance, sync_days, site_map}
  schedule    TEXT NOT NULL DEFAULT 'DAILY',   -- MANUALE | HOURLY | DAILY
  last_sync_at TIMESTAMPTZ,
  last_status TEXT,                            -- OK | ERRORE | MAI
  last_message TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sync_log (
  id           BIGSERIAL PRIMARY KEY,
  connector_id INT REFERENCES connectors(id) ON DELETE CASCADE,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  status       TEXT,
  rows_read    INT NOT NULL DEFAULT 0,
  rows_written INT NOT NULL DEFAULT 0,
  message      TEXT
);

-- Importazioni da file (Excel/CSV esportati dai gestionali)
CREATE TABLE import_batches (
  id          SERIAL PRIMARY KEY,
  source      TEXT NOT NULL,                  -- GIPO | TUOTEMPO | STUDIOLAB | IMPORT
  dataset     TEXT NOT NULL,                  -- SALES | CUSTOMERS | PRODUCTS
  filename    TEXT NOT NULL,
  mapping     JSONB NOT NULL DEFAULT '{}'::jsonb,
  rows_total  INT NOT NULL DEFAULT 0,
  rows_ok     INT NOT NULL DEFAULT 0,
  rows_skipped INT NOT NULL DEFAULT 0,
  errors      JSONB NOT NULL DEFAULT '[]'::jsonb,
  status      TEXT NOT NULL DEFAULT 'OK',
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE sales ADD CONSTRAINT sales_batch_fk FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;

-- Mappature colonne salvate per sorgente e dataset (si riusano al prossimo import)
CREATE TABLE import_mappings (
  id         SERIAL PRIMARY KEY,
  source     TEXT NOT NULL,
  dataset    TEXT NOT NULL,
  mapping    JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, dataset)
);
