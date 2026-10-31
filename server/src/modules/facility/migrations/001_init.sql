-- Modulo Facility e Manutenzioni (schema "facility" della Suite, search_path = facility, public). Richiesta del CEO del 31/10/2026.
-- Nessuna anagrafica propria: sedi = public.sites, Legal entity = public.organizations, tipi di dispositivo = public.asset_types
-- (Amministrazione > Anagrafiche > Catalogo dispositivi). Contratti di affitto, utenze e bollette restano in Payments (schema finance:
-- lease_contracts, utilities, utility_bills) e qui sono solo riferiti per id (nessuna FK tra schemi: verificati dal codice).

-- Riga tecnica dell'utente del modulo (adattatore moduleUser). Ruolo = profilo del grant: ADMIN, FACILITY, MANUTENTORE, SITE, VIEWER.
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'VIEWER',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Immobili ----------
-- Un immobile per sede dell'anagrafica (creato al volo per le sedi attive non SERVICE). lease_id = finance.lease_contracts.id
-- (riferimento logico, verificato dal codice; vuoto = contratto attivo della sede in Payments, se c'è).
CREATE TABLE IF NOT EXISTS properties (
  id                   SERIAL PRIMARY KEY,
  site_id              INT NOT NULL UNIQUE REFERENCES public.sites(id) ON DELETE CASCADE,
  tenure               TEXT NOT NULL DEFAULT 'LOCAZIONE' CHECK (tenure IN ('PROPRIETA','LOCAZIONE','COMODATO','OSPITATA')),
  lease_id             INT,
  landlord_org_id      INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  surface_sqm          NUMERIC(10,2) CHECK (surface_sqm IS NULL OR surface_sqm >= 0),
  floors               INT,
  rooms                INT,
  cadastral            JSONB NOT NULL DEFAULT '{}'::jsonb,       -- { foglio, particella, sub, categoria, rendita }
  energy_class         TEXT,                                     -- classe dell'APE (A4 ... G)
  ape_valid_until      DATE,
  heating_type         TEXT,
  cooling_type         TEXT,
  year_built           INT,
  occupancy_days_week  NUMERIC(3,1) CHECK (occupancy_days_week IS NULL OR occupancy_days_week BETWEEN 0 AND 7),
  opening_hours_week   NUMERIC(5,1) CHECK (opening_hours_week IS NULL OR opening_hours_week BETWEEN 0 AND 168),
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by           INT REFERENCES users(id) ON DELETE SET NULL
);

-- Obblighi di controllo previsti dal contratto, dalla legge o dall'assicurazione (es. manutenzione semestrale della caldaia a carico
-- del conduttore). Generano scadenze nel piano (maintenance_plans.obligation_id).
CREATE TABLE IF NOT EXISTS property_obligations (
  id               SERIAL PRIMARY KEY,
  property_id      INT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  kind             TEXT NOT NULL DEFAULT 'CONTRATTUALE' CHECK (kind IN ('CONTRATTUALE','NORMATIVO','ASSICURATIVO')),
  interval_months  INT NOT NULL CHECK (interval_months BETWEEN 1 AND 240),
  first_due        DATE NOT NULL,
  responsible      TEXT,                                         -- ruolo o testo (es. "Conduttore", "Locatore", "RSPP")
  asset_type_code  TEXT REFERENCES public.asset_types(code) ON UPDATE CASCADE ON DELETE SET NULL,
  cost_estimate    NUMERIC(12,2) CHECK (cost_estimate IS NULL OR cost_estimate >= 0),
  notes            TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       INT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS property_obligations_prop_idx ON property_obligations (property_id);

-- Documenti dell'immobile (planimetrie, contratti, certificazioni, verbali). File a due vie (lib/moduleStorage.js): bytea o blob.
-- La PLANIMETRIA più recente si pubblica anche a Room Planning (room.struttura_blobs planPdf / planImg): Facility è la fonte.
CREATE TABLE IF NOT EXISTS property_documents (
  id                 SERIAL PRIMARY KEY,
  property_id        INT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind               TEXT NOT NULL DEFAULT 'ALTRO' CHECK (kind IN ('PLANIMETRIA','CONTRATTO','CERTIFICAZIONE','VERBALE','ALTRO')),
  title              TEXT,
  filename           TEXT NOT NULL,
  mime               TEXT NOT NULL,
  size               INT NOT NULL DEFAULT 0,
  sha256             TEXT,
  data               BYTEA,
  blob_path          TEXT,
  valid_until        DATE,                                       -- scadenza (certificazioni, APE, CPI)
  published_room_at  TIMESTAMPTZ,                                -- planimetria pubblicata in Room Planning
  notes              TEXT,
  uploaded_by        INT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS property_documents_prop_idx ON property_documents (property_id, kind, created_at DESC);

-- ---------- Dispositivi ----------
CREATE TABLE IF NOT EXISTS assets (
  id                           SERIAL PRIMARY KEY,
  site_id                      INT NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  asset_type_code              TEXT NOT NULL REFERENCES public.asset_types(code) ON UPDATE CASCADE,
  code                         TEXT NOT NULL UNIQUE,              -- codice interno (es. PRA-EST-001)
  name                         TEXT,                              -- descrizione libera (es. "Estintore corridoio")
  brand                        TEXT,
  model                        TEXT,
  serial                       TEXT,
  location                     TEXT,                              -- locale / piano
  installed_at                 DATE,
  warranty_until               DATE,
  vendor_org_id                INT REFERENCES public.organizations(id) ON DELETE SET NULL,   -- manutentore (Legal entity)
  contract_ref                 TEXT,
  status                       TEXT NOT NULL DEFAULT 'IN_SERVIZIO' CHECK (status IN ('IN_SERVIZIO','FUORI_SERVIZIO','DISMESSO')),
  surveillance_months          INT,                               -- periodicità propria (vuota = quella del catalogo)
  check_interval_months        INT,
  maintenance_interval_months  INT,
  next_check_due               DATE,
  next_maintenance_due         DATE,
  last_outcome                 TEXT,                              -- esito dell'ultimo controllo chiuso (CONFORME, NON_CONFORME, CON_PRESCRIZIONI)
  notes                        TEXT,
  qr_code                      TEXT NOT NULL UNIQUE,              -- token stampato nel QR (apre la scheda del dispositivo)
  created_by                   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_site_idx ON assets (site_id, status);
CREATE INDEX IF NOT EXISTS assets_type_idx ON assets (asset_type_code);

-- Allegati di scadenze e interventi (rapportini, foto)
CREATE TABLE IF NOT EXISTS files (
  id           SERIAL PRIMARY KEY,
  entity       TEXT NOT NULL CHECK (entity IN ('PLAN','WORK_ORDER')),
  entity_id    INT NOT NULL,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size         INT NOT NULL DEFAULT 0,
  sha256       TEXT,
  data         BYTEA,
  blob_path    TEXT,
  label        TEXT,
  uploaded_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_entity_idx ON files (entity, entity_id);

-- Piano delle manutenzioni: una riga per scadenza. stream = serie a cui appartiene (SORVEGLIANZA a cura della sede, CONTROLLO,
-- MANUTENZIONE del dispositivo, OBBLIGO dell'immobile): alla chiusura nasce la successiva della stessa serie (generated_from).
CREATE TABLE IF NOT EXISTS maintenance_plans (
  id               SERIAL PRIMARY KEY,
  site_id          INT NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  asset_id         INT REFERENCES assets(id) ON DELETE CASCADE,
  obligation_id    INT REFERENCES property_obligations(id) ON DELETE CASCADE,
  stream           TEXT NOT NULL CHECK (stream IN ('SORVEGLIANZA','CONTROLLO','MANUTENZIONE','OBBLIGO')),
  kind             TEXT NOT NULL CHECK (kind IN ('CONTROLLO','MANUTENZIONE','VERIFICA_NORMATIVA','COLLAUDO')),
  performer        TEXT NOT NULL DEFAULT 'MANUTENTORE' CHECK (performer IN ('SEDE','MANUTENTORE','ENTE')),
  title            TEXT NOT NULL,
  interval_months  INT,
  due_date         DATE NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PIANIFICATA' CHECK (status IN ('PIANIFICATA','ESEGUITA','SCADUTA','ANNULLATA')),
  done_at          DATE,
  done_by          INT REFERENCES users(id) ON DELETE SET NULL,
  done_by_name     TEXT,
  outcome          TEXT CHECK (outcome IS NULL OR outcome IN ('CONFORME','NON_CONFORME','CON_PRESCRIZIONI')),
  report_file_id   INT REFERENCES files(id) ON DELETE SET NULL,
  cost             NUMERIC(12,2) CHECK (cost IS NULL OR cost >= 0),
  notes            TEXT,
  generated_from   INT REFERENCES maintenance_plans(id) ON DELETE SET NULL,
  work_order_id    INT,                                           -- intervento correttivo aperto da un esito non conforme
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (asset_id IS NOT NULL OR obligation_id IS NOT NULL)
);
-- una sola scadenza aperta per serie (dispositivo o obbligo): la rigenerazione non duplica
CREATE UNIQUE INDEX IF NOT EXISTS plans_open_asset_uq ON maintenance_plans (asset_id, stream) WHERE asset_id IS NOT NULL AND status IN ('PIANIFICATA','SCADUTA');
CREATE UNIQUE INDEX IF NOT EXISTS plans_open_obl_uq ON maintenance_plans (obligation_id) WHERE obligation_id IS NOT NULL AND status IN ('PIANIFICATA','SCADUTA');
CREATE INDEX IF NOT EXISTS plans_due_idx ON maintenance_plans (status, due_date);
CREATE INDEX IF NOT EXISTS plans_site_idx ON maintenance_plans (site_id, due_date);

-- Promemoria inviati per scadenza (30, 7, 0 giorni): mai doppi
CREATE TABLE IF NOT EXISTS plan_reminders (
  plan_id   INT NOT NULL REFERENCES maintenance_plans(id) ON DELETE CASCADE,
  stage     TEXT NOT NULL CHECK (stage IN ('D30','D7','D0')),
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  users     INT NOT NULL DEFAULT 0,
  PRIMARY KEY (plan_id, stage)
);

-- ---------- Interventi (correttivi e segnalazioni di guasto) ----------
CREATE TABLE IF NOT EXISTS work_orders (
  id                SERIAL PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,                         -- WO-AAAA-NNNN
  site_id           INT NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  asset_id          INT REFERENCES assets(id) ON DELETE SET NULL,
  plan_id           INT REFERENCES maintenance_plans(id) ON DELETE SET NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  location          TEXT,
  priority          TEXT NOT NULL DEFAULT 'MEDIA' CHECK (priority IN ('BASSA','MEDIA','ALTA','URGENTE')),
  status            TEXT NOT NULL DEFAULT 'APERTO' CHECK (status IN ('APERTO','ASSEGNATO','IN_CORSO','SOSPESO','CHIUSO')),
  reported_by       INT REFERENCES users(id) ON DELETE SET NULL,
  reported_by_name  TEXT,
  assigned_user_id  INT REFERENCES public.users(id) ON DELETE SET NULL,   -- manutentore interno (utente Suite)
  vendor_org_id     INT REFERENCES public.organizations(id) ON DELETE SET NULL,   -- manutentore esterno (Legal entity)
  opened_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  assigned_at       TIMESTAMPTZ,
  started_at        TIMESTAMPTZ,
  due_at            TIMESTAMPTZ,                                  -- opened_at + SLA della priorità
  closed_at         TIMESTAMPTZ,
  resolution        TEXT,
  cost              NUMERIC(12,2) CHECK (cost IS NULL OR cost >= 0),
  downtime_hours    NUMERIC(8,2) CHECK (downtime_hours IS NULL OR downtime_hours >= 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_orders_site_idx ON work_orders (site_id, status);
CREATE INDEX IF NOT EXISTS work_orders_status_idx ON work_orders (status, priority);

CREATE TABLE IF NOT EXISTS work_order_events (
  id           SERIAL PRIMARY KEY,
  wo_id        INT NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      INT REFERENCES users(id) ON DELETE SET NULL,
  user_name    TEXT,
  action       TEXT NOT NULL,                                     -- APERTURA, ASSEGNAZIONE, STATO, NOTA, CHIUSURA, RIAPERTURA
  from_status  TEXT,
  to_status    TEXT,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS work_order_events_wo_idx ON work_order_events (wo_id, at);

-- ---------- Energia ----------
-- Estensione Facility delle utenze di Payments: utility_id = finance.utilities.id (riferimento logico)
CREATE TABLE IF NOT EXISTS utility_meta (
  utility_id           INT PRIMARY KEY,
  vector               TEXT NOT NULL DEFAULT 'ELETTRICO' CHECK (vector IN ('ELETTRICO','GAS','ACQUA','TELERISCALDAMENTO','GASOLIO','ALTRO')),
  pod_pdr              TEXT,
  contracted_power_kw  NUMERIC(10,2),
  tariff               TEXT,
  co2_factor           NUMERIC(10,5),                             -- kgCO2 per unità (vuoto = fattore predefinito del vettore)
  unit                 TEXT,                                      -- kWh, Smc, m3, l
  notes                TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Letture dei contatori (manuali, da bolletta, da contatore intelligente)
CREATE TABLE IF NOT EXISTS meter_readings (
  id          SERIAL PRIMARY KEY,
  utility_id  INT NOT NULL,
  read_at     DATE NOT NULL,
  value       NUMERIC(16,3) NOT NULL CHECK (value >= 0),
  source      TEXT NOT NULL DEFAULT 'MANUALE' CHECK (source IN ('MANUALE','BOLLETTA','SMART')),
  notes       TEXT,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (utility_id, read_at)
);

-- Attività per sede e mese (misura per gli indicatori di intensità): da Retail (accettazioni), da Cash (giorni con rendiconto) o a mano
CREATE TABLE IF NOT EXISTS activity_metrics (
  site_id          INT NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  month            DATE NOT NULL,                                 -- primo giorno del mese
  accettazioni     INT,
  prestazioni      INT,
  ore_apertura     NUMERIC(8,1),
  giorni_apertura  INT,
  source           TEXT NOT NULL DEFAULT 'MANUALE' CHECK (source IN ('RETAIL','CASH','MANUALE')),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (site_id, month)
);

-- Obiettivi di riduzione (site_id NULL = rete; vector NULL = energia totale in kWh equivalenti)
CREATE TABLE IF NOT EXISTS energy_targets (
  id                    SERIAL PRIMARY KEY,
  site_id               INT REFERENCES public.sites(id) ON DELETE CASCADE,
  year                  INT NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  vector                TEXT CHECK (vector IS NULL OR vector IN ('ELETTRICO','GAS','ACQUA','TELERISCALDAMENTO','GASOLIO','ALTRO')),
  target_pct_reduction  NUMERIC(5,2) NOT NULL CHECK (target_pct_reduction BETWEEN 0 AND 100),
  baseline_year         INT NOT NULL CHECK (baseline_year BETWEEN 2000 AND 2100),
  notes                 TEXT,
  created_by            INT REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS energy_targets_uq ON energy_targets (coalesce(site_id, 0), year, coalesce(vector, '*'));

-- Analisi dei consumi con Claude (facoltativa)
CREATE TABLE IF NOT EXISTS energy_analyses (
  id            SERIAL PRIMARY KEY,
  site_id       INT REFERENCES public.sites(id) ON DELETE CASCADE,  -- NULL = rete
  year          INT NOT NULL,
  model         TEXT,
  result        JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_by  INT REFERENCES users(id) ON DELETE SET NULL,
  generated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS energy_analyses_idx ON energy_analyses (coalesce(site_id, 0), year, generated_at DESC);

-- Anomalie già notificate (una volta per utenza e mese)
CREATE TABLE IF NOT EXISTS anomaly_notified (
  key          TEXT PRIMARY KEY,                                   -- <utility_id>:<AAAA-MM>
  notified_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Impostazioni del modulo (SLA, fattori CO2, promemoria, fonte dell'attività, soglia anomalie)
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  INT
);

-- Sedi gestite: sedi TD non SERVICE con il site manager dall'organigramma (stessa regola di audit.sites_v e room.sites_v)
CREATE OR REPLACE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.short_name, s.kind, s.address, s.zip, s.city, s.province, s.organization_id, s.host_organization_id,
         coalesce(h.person_name, s.manager_name) AS manager_name, h.person_email AS manager_email, s.active, s.sort_order, s.opened_at
    FROM public.sites s
    LEFT JOIN LATERAL (SELECT pp.last_name || ' ' || pp.first_name AS person_name, pp.email AS person_email
                         FROM public.org_units u JOIN public.org_positions op ON op.unit_id = u.id AND op.is_head
                         JOIN public.people pp ON pp.id = op.person_id
                        WHERE u.kind = 'SEDE' AND u.site_id = s.id ORDER BY op.sort_order, op.id LIMIT 1) h ON TRUE
   WHERE s.kind <> 'SERVICE';
