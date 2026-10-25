-- Giorni lavorati, budget, scostamenti, dati di mercato, struttura delle sedi

-- Giorni lavorati per anno/mese: pianificati (impostabili) e reali (dalle vendite, con override manuale)
CREATE TABLE working_days (
  id        SERIAL PRIMARY KEY,
  year      INT NOT NULL,
  month     INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  site_id   INT REFERENCES sites(id) ON DELETE CASCADE,   -- NULL = intero network
  planned   INT NOT NULL DEFAULT 0,
  actual_override INT,                                     -- se valorizzato prevale sul conteggio dalle vendite
  notes     TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX working_days_uq ON working_days (year, month, coalesce(site_id, 0));

-- Budget per anno/mese, per linea e per sede (NULL = totale)
CREATE TABLE budgets (
  id        SERIAL PRIMARY KEY,
  year      INT NOT NULL,
  month     INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  line_id   INT REFERENCES product_lines(id) ON DELETE CASCADE,
  site_id   INT REFERENCES sites(id) ON DELETE CASCADE,
  amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  tickets   INT,
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX budgets_uq ON budgets (year, month, coalesce(line_id, 0), coalesce(site_id, 0));

-- Motivazioni annotate sugli scostamenti (interne) e ipotesi esterne salvate
CREATE TABLE variance_notes (
  id        SERIAL PRIMARY KEY,
  year      INT NOT NULL,
  month     INT NOT NULL,
  line_id   INT REFERENCES product_lines(id) ON DELETE CASCADE,
  site_id   INT REFERENCES sites(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL DEFAULT 'INTERNA' CHECK (kind IN ('INTERNA','ESTERNA','AZIONE')),
  note      TEXT NOT NULL,
  author_id INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX variance_notes_ym_idx ON variance_notes (year, month);

-- Dati di mercato per territorio (comune, provincia, regione, Italia) e per codice ATECO
CREATE TABLE market_data (
  id             SERIAL PRIMARY KEY,
  year           INT NOT NULL,
  territory_kind TEXT NOT NULL CHECK (territory_kind IN ('COMUNE','PROVINCIA','REGIONE','ITALIA')),
  territory      TEXT NOT NULL,          -- nome del comune / sigla provincia / regione / 'Italia'
  province       TEXT,
  ateco          TEXT,                   -- sezione o divisione ATECO (es. C, 86, 86.10); NULL = indicatore generale
  metric         TEXT NOT NULL,          -- popolazione, contribuenti, reddito_medio, reddito_imponibile_medio, quota_redditi_bassi, quota_redditi_alti, eta_media, famiglie, imprese_attive, addetti, spesa_salute_famiglia, ...
  value          NUMERIC(16,4) NOT NULL,
  source         TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX market_data_uq ON market_data (year, territory_kind, lower(territory), coalesce(ateco, ''), metric);

-- Struttura delle sedi
ALTER TABLE sites ADD COLUMN surface_sqm INT;
ALTER TABLE sites ADD COLUMN rooms INT;
ALTER TABLE sites ADD COLUMN boxes INT;                       -- box prelievo / postazioni
ALTER TABLE sites ADD COLUMN parking TEXT;
ALTER TABLE sites ADD COLUMN accessibility TEXT;
ALTER TABLE sites ADD COLUMN services TEXT;                   -- descrizione dei servizi offerti
ALTER TABLE sites ADD COLUMN description TEXT;
ALTER TABLE sites ADD COLUMN opened_at DATE;
ALTER TABLE sites ADD COLUMN saturday_open BOOLEAN NOT NULL DEFAULT TRUE;   -- per il calcolo dei giorni lavorabili
ALTER TABLE sites ADD COLUMN catchment_cities TEXT;           -- comuni del bacino (separati da virgola) per i dati di mercato

CREATE TABLE site_staff (
  id          SERIAL PRIMARY KEY,
  site_id     INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,              -- Site manager, Accettazione, Infermiere, Tecnico, Medico, Anestesista, Biologo, Amministrativo
  kind        TEXT NOT NULL DEFAULT 'DIPENDENTE' CHECK (kind IN ('DIPENDENTE','LP','ESTERNO')),
  specialty   TEXT,
  weekly_hours NUMERIC(5,2),
  days        TEXT,                        -- es. lun-ven, mar/gio
  phone       TEXT,
  email       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  notes       TEXT,
  sort_order  INT NOT NULL DEFAULT 100
);
CREATE INDEX site_staff_site_idx ON site_staff (site_id);

CREATE TABLE site_hours (
  id        SERIAL PRIMARY KEY,
  site_id   INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  weekday   INT NOT NULL CHECK (weekday BETWEEN 1 AND 7),   -- 1 = lunedì
  closed    BOOLEAN NOT NULL DEFAULT FALSE,
  open1     TIME, close1 TIME, open2 TIME, close2 TIME,
  note      TEXT,                                            -- es. prelievi solo 7:30-10:30
  UNIQUE (site_id, weekday)
);

CREATE TABLE site_assets (
  id        SERIAL PRIMARY KEY,
  site_id   INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,     -- RM, TC, MAMMOGRAFO, ECOGRAFO, RX, MOC, EMG, AMBULATORIO, BOX_PRELIEVO, MONITOR, TOTEM, ALTRO
  name      TEXT NOT NULL,
  quantity  INT NOT NULL DEFAULT 1,
  details   TEXT,              -- modello, tesla, anno, note
  active    BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX site_assets_site_idx ON site_assets (site_id);

-- Operatore di accettazione (chi vende): dagli export dei gestionali o dall'inserimento manuale
ALTER TABLE sales ADD COLUMN operator TEXT;
CREATE INDEX sales_operator_idx ON sales (operator) WHERE operator IS NOT NULL;
