-- Scadenziario strutture nel widget Payments (richiesta del CEO, 28/10/2026, docs/ANAGRAFICA.md): contratti di affitto con gli
-- scatti del canone, utenze con le bollette registrate, esiti delle scadenze, collegamento con le istanze di pagamento e registro
-- degli avvisi inviati. Le sedi sono quelle dell'anagrafica unica (public.sites); locatore e fornitore sono Legal entity
-- (public.organizations), facoltativi, con il beneficiario Payments (beneficiaries) per creare le istanze. Le scadenze non si
-- salvano: si calcolano da contratti e utenze (lib/schedule.js); qui restano esiti (schedule_done), istanze collegate
-- (schedule_requests) e avvisi (schedule_notified).

-- ---------- Contratti di affitto ----------
CREATE TABLE IF NOT EXISTS lease_contracts (
  id                   SERIAL PRIMARY KEY,
  site_id              INT NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  landlord_org_id      INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  landlord_name        TEXT,
  beneficiary_id       INT REFERENCES beneficiaries(id) ON DELETE SET NULL,   -- beneficiario Payments del locatore (per le istanze)
  unit                 TEXT,                                   -- immobile / unità (piano terra, box, magazzino)
  kind                 TEXT NOT NULL DEFAULT 'COMMERCIALE_6_6' CHECK (kind IN ('COMMERCIALE_6_6','COMMERCIALE_9_9','ABITATIVO_4_4','ABITATIVO_3_2','TRANSITORIO','COMODATO','ALTRO')),
  start_date           DATE NOT NULL,                          -- decorrenza
  first_term_years     INT CHECK (first_term_years IS NULL OR first_term_years BETWEEN 0 AND 99),
  renewal_years        INT CHECK (renewal_years IS NULL OR renewal_years BETWEEN 0 AND 99),   -- 0 o NULL = nessun rinnovo tacito
  notice_months        INT CHECK (notice_months IS NULL OR notice_months BETWEEN 0 AND 60),
  period_months        INT NOT NULL DEFAULT 1 CHECK (period_months IN (1,2,3,6,12)),
  first_due            DATE,                                   -- prima scadenza della rata (vuota = decorrenza)
  deposit              NUMERIC(12,2) CHECK (deposit IS NULL OR deposit >= 0),
  registration         TEXT CHECK (registration IS NULL OR registration IN ('IMPOSTA_ANNUALE','UNICA_SOLUZIONE','CEDOLARE_SECCA','DA_REGISTRARE')),
  istat                BOOLEAN NOT NULL DEFAULT FALSE,         -- adeguamento ISTAT annuale
  auto_pay             BOOLEAN NOT NULL DEFAULT FALSE,         -- RID / bonifico permanente
  business_contract_id INT,                                    -- contratto SEDE del widget Business (solo riferimento, nessuna FK tra schemi)
  notes                TEXT,
  active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_by           INT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lease_contracts_site_idx ON lease_contracts (site_id, active);

-- Scatti del canone: importo della rata valido dalla data. Il canone vigente a una data = ultimo scatto con valid_from <= data.
CREATE TABLE IF NOT EXISTS lease_steps (
  id          SERIAL PRIMARY KEY,
  lease_id    INT NOT NULL REFERENCES lease_contracts(id) ON DELETE CASCADE,
  valid_from  DATE NOT NULL,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  reason      TEXT NOT NULL DEFAULT 'ALTRO' CHECK (reason IN ('INIZIALE','ISTAT','RINEGOZIAZIONE','ALTRO')),
  pct         NUMERIC(6,3),                                    -- variazione % applicata, se nota
  notes       TEXT,
  created_by  INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (lease_id, valid_from)
);

-- ---------- Utenze ----------
CREATE TABLE IF NOT EXISTS utilities (
  id               SERIAL PRIMARY KEY,
  site_id          INT NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL DEFAULT 'ALTRO' CHECK (kind IN ('ENERGIA','GAS','ACQUA','TARI','TELEFONIA','CONDOMINIO','VIGILANZA','PULIZIE','ALTRO')),
  supplier_org_id  INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  supplier_name    TEXT,
  beneficiary_id   INT REFERENCES beneficiaries(id) ON DELETE SET NULL,       -- beneficiario Payments del fornitore (per le istanze)
  code             TEXT,                                       -- POD / PDR / numero cliente
  holder           TEXT,                                       -- intestatario attuale
  transfer_status  TEXT NOT NULL DEFAULT 'NON_NECESSARIA' CHECK (transfer_status IN ('DA_AVVIARE','IN_CORSO','COMPLETATA','NON_NECESSARIA')),   -- voltura
  period_months    INT NOT NULL DEFAULT 2 CHECK (period_months IN (1,2,3,4,6,12)),
  ref_due          DATE,                                       -- scadenza nota da cui calcolare le prossime
  avg_amount       NUMERIC(12,2) CHECK (avg_amount IS NULL OR avg_amount >= 0),
  offer_end        DATE,
  auto_pay         BOOLEAN NOT NULL DEFAULT FALSE,
  notes            TEXT,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_by       INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS utilities_site_idx ON utilities (site_id, active);

-- Bollette registrate (gli "scatti" delle utenze): importo reale di un periodo, pagata se paid_at
CREATE TABLE IF NOT EXISTS utility_bills (
  id           SERIAL PRIMARY KEY,
  utility_id   INT NOT NULL REFERENCES utilities(id) ON DELETE CASCADE,
  period_from  DATE,
  period_to    DATE,
  due_date     DATE NOT NULL,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  consumption  NUMERIC(14,3),
  unit         TEXT,                                           -- kWh, Smc, mc, ...
  paid_at      DATE,
  notes        TEXT,
  created_by   INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS utility_bills_utility_idx ON utility_bills (utility_id, due_date);

-- ---------- Esiti e avvisi ----------
-- Scadenza segnata come pagata / fatta: la chiave è quella dell'evento calcolato (es. "canone:lease:12:2026-11-01")
CREATE TABLE IF NOT EXISTS schedule_done (
  event_key  TEXT PRIMARY KEY,
  site_id    INT,
  done_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id    INT,
  note       TEXT,
  amount     NUMERIC(12,2),                                    -- importo effettivamente pagato, se diverso
  request_id INT REFERENCES payment_requests(id) ON DELETE SET NULL   -- istanza eseguita che ha chiuso la scadenza
);
CREATE INDEX IF NOT EXISTS schedule_done_site_idx ON schedule_done (site_id);

-- Istanze di pagamento create dallo scadenziario: una per scadenza; il collegamento cade se l'istanza viene annullata o rifiutata
CREATE TABLE IF NOT EXISTS schedule_requests (
  event_key   TEXT PRIMARY KEY,
  request_id  INT NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schedule_requests_request_idx ON schedule_requests (request_id);

-- Avvisi già inviati (per non ripeterli)
CREATE TABLE IF NOT EXISTS schedule_notified (
  event_key    TEXT PRIMARY KEY,
  notified_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Impostazioni (gruppo "Scadenziario strutture" delle Impostazioni di Payments) ----------
INSERT INTO app_settings (key, value) VALUES
  ('schedule_alert_days', '7'),                                -- giorni di anticipo degli avvisi
  ('schedule_istat_pct', '1.5'),                               -- ipotesi di rivalutazione ISTAT annua per la previsione
  ('schedule_utility_growth_pct', '0'),                        -- ipotesi di crescita annua delle utenze per la previsione
  ('schedule_notify_roles', 'CEO,CFO,SUPPORT')                 -- profili Payments che ricevono gli avvisi in app
ON CONFLICT (key) DO NOTHING;
