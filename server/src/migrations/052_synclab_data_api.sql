-- Synclab Data API v1 (CB Sistemi, consegna del 09/11/2026): copia locale in sola lettura dei cinque insiemi di dati del gestionale
-- (clienti, esami, listini, accettazioni, documenti economici), stato di sincronizzazione per ambito e storico dei cicli.
-- Contratto: docs/synclab-data-api/01_CONTRATTO_API.md; architettura: docs/SYNCLAB_DATA_API.md.
-- Migrazione idempotente e NON distruttiva: solo CREATE ... IF NOT EXISTS e CREATE OR REPLACE VIEW, nessun dato toccato.
-- Regole comuni:
--  - chiave del record (instance_id, dataset, id): una tabella per insieme di dati con chiave (instance_id, id); i figli stanno nel contesto
--    dell'aggregato (instance_id, <padre>_id, ord) e conservano il loro id opaco in una colonna;
--  - importi, quantità, aliquote e sconti in numeric senza scala (nessun arrotondamento); null resta null;
--  - ogni aggregato e ogni figlio conserva il JSON originale (raw) per i campi non riconosciuti;
--  - nessuna chiave esterna fra insiemi di dati: le fotografie sono indipendenti e i riferimenti possono arrivare prima dei record;
--  - disponibilita: ATTIVO | RIMOSSO_STATO_ESCLUSO | FUORI_AMBITO | ARCHIVIATO | USCITA_INCERTA (con il motivo della sorgente);
--  - le colonne patient_* e historical_description si valorizzano solo in un ambito con include_patient = true (opt-in del connettore).
CREATE SCHEMA IF NOT EXISTS synclab;

-- ------------------------------------------------------------------ stato della sincronizzazione
-- Un ambito = (istanza, client tecnico, insieme di dati, filtri canonici, proiezione paziente). Cambiare filtro, proiezione o client
-- crea un ambito nuovo che parte con un completo. checkpoint = syncToken confermato (solo dopo il commit dell'ultima pagina).
CREATE TABLE IF NOT EXISTS synclab.sync_scope (
  id                SERIAL PRIMARY KEY,
  instance_id       TEXT NOT NULL,
  client_name       TEXT NOT NULL,
  dataset           TEXT NOT NULL CHECK (dataset IN ('clients','exams','price-lists','requests','invoices')),
  filtri_canonici   JSONB NOT NULL DEFAULT '{}'::jsonb,
  include_patient   BOOLEAN NOT NULL DEFAULT FALSE,
  checkpoint        TEXT,                    -- syncToken confermato (opaco): mai nei log
  checkpoint_at     TIMESTAMPTZ,             -- capturedAt della fotografia che ha prodotto il checkpoint
  ultimo_completo_at TIMESTAMPTZ,            -- fine dell'ultimo completo riuscito
  pagina_in_sospeso JSONB,                   -- { tipo, path, query, since?, cursor, snapshot_id, pagine_fatte, record_fatti, run_id, fase }
  in_corso          BOOLEAN NOT NULL DEFAULT FALSE,
  lock_at           TIMESTAMPTZ,
  lock_pid          TEXT,
  ultimo_esito      JSONB,                   -- { stato, errore, correlationId, durata_ms, conteggi, at, run_id }
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (instance_id, client_name, dataset, filtri_canonici, include_patient)
);

CREATE TABLE IF NOT EXISTS synclab.sync_run (
  id              SERIAL PRIMARY KEY,
  scope_id        INT NOT NULL REFERENCES synclab.sync_scope(id) ON DELETE CASCADE,
  dataset         TEXT NOT NULL,
  tipo            TEXT NOT NULL CHECK (tipo IN ('COMPLETO','DELTA','RICONCILIAZIONE')),
  origine         TEXT,                      -- NOTTURNO | MANUALE | RIPRESA
  iniziato        TIMESTAMPTZ NOT NULL DEFAULT now(),
  finito          TIMESTAMPTZ,
  esito           TEXT NOT NULL DEFAULT 'IN_CORSO' CHECK (esito IN ('IN_CORSO','OK','ERRORE','INTERROTTO')),
  pagine          INT NOT NULL DEFAULT 0,
  record          INT NOT NULL DEFAULT 0,
  upsert          INT NOT NULL DEFAULT 0,
  remove          INT NOT NULL DEFAULT 0,
  fuori_ambito    INT NOT NULL DEFAULT 0,
  archived        INT NOT NULL DEFAULT 0,
  unavailable     INT NOT NULL DEFAULT 0,
  gia_applicati   INT NOT NULL DEFAULT 0,
  verificati      INT NOT NULL DEFAULT 0,  -- id interrogati con /sync/status nella riconciliazione
  durata_ms       INT,
  attesa_ms       INT NOT NULL DEFAULT 0,  -- tempo passato ad aspettare la cattura (202) e i Retry-After
  prima_importazione BOOLEAN NOT NULL DEFAULT FALSE,
  errore          TEXT,
  correlation_id  TEXT
);
CREATE INDEX IF NOT EXISTS sync_run_scope_idx ON synclab.sync_run (scope_id, iniziato DESC);
CREATE INDEX IF NOT EXISTS sync_run_iniziato_idx ON synclab.sync_run (iniziato DESC);

-- Appartenenza di un record a un ambito: un out_of_scope toglie il record da quell'ambito senza cancellarlo dagli altri.
CREATE TABLE IF NOT EXISTS synclab.scope_records (
  scope_id    INT NOT NULL REFERENCES synclab.sync_scope(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  stato       TEXT NOT NULL CHECK (stato IN ('ATTIVO','RIMOSSO_STATO_ESCLUSO','FUORI_AMBITO','ARCHIVIATO','USCITA_INCERTA')),
  reason      TEXT,
  revision    TEXT,
  operation   TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_id, id)
);
-- id visti durante un completo (servono alla riconciliazione degli assenti, anche dopo un'interruzione)
CREATE TABLE IF NOT EXISTS synclab.run_visti (
  run_id  INT NOT NULL REFERENCES synclab.sync_run(id) ON DELETE CASCADE,
  id      TEXT NOT NULL,
  PRIMARY KEY (run_id, id)
);

-- ------------------------------------------------------------------ insiemi di dati
CREATE TABLE IF NOT EXISTS synclab.clients (
  instance_id TEXT NOT NULL, id TEXT NOT NULL,
  client_code TEXT, legal_name TEXT, billing_client_id TEXT, operating_company TEXT, vat_number TEXT, fiscal_code TEXT,
  address TEXT, city TEXT, province TEXT, postal_code TEXT, phone1 TEXT, phone2 TEXT, email TEXT, invoice_email TEXT, non_conformity_email TEXT,
  price_list_id TEXT, extra_price_list_id TEXT, active BOOLEAN,
  site_description TEXT, site_address TEXT, site_city TEXT, site_province TEXT, site_postal_code TEXT, site_phone TEXT,
  raw JSONB,
  revision TEXT, disponibilita TEXT NOT NULL DEFAULT 'ATTIVO', disponibilita_reason TEXT, captured_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  PRIMARY KEY (instance_id, id)
);
CREATE INDEX IF NOT EXISTS clients_code_idx ON synclab.clients (lower(client_code));

CREATE TABLE IF NOT EXISTS synclab.exams (
  instance_id TEXT NOT NULL, id TEXT NOT NULL,
  exam_code TEXT, description TEXT, category TEXT, branch_code TEXT, specialty_code TEXT, regional_code TEXT, active BOOLEAN,
  raw JSONB,
  revision TEXT, disponibilita TEXT NOT NULL DEFAULT 'ATTIVO', disponibilita_reason TEXT, captured_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  PRIMARY KEY (instance_id, id)
);
CREATE INDEX IF NOT EXISTS exams_code_idx ON synclab.exams (exam_code);

CREATE TABLE IF NOT EXISTS synclab.price_lists (
  instance_id TEXT NOT NULL, id TEXT NOT NULL,
  code TEXT, description TEXT, type INT, state INT, active BOOLEAN, operating_company TEXT,
  raw JSONB,   -- testata senza le righe (le righe hanno il loro raw in price_list_items)
  revision TEXT, disponibilita TEXT NOT NULL DEFAULT 'ATTIVO', disponibilita_reason TEXT, captured_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  PRIMARY KEY (instance_id, id)
);
CREATE TABLE IF NOT EXISTS synclab.price_list_items (
  instance_id TEXT NOT NULL, price_list_id TEXT NOT NULL, ord INT NOT NULL, id TEXT,
  exam_id TEXT, exam_code TEXT, description TEXT,
  gross_unit_price_excluding_vat NUMERIC, discount_percent NUMERIC, net_unit_price_excluding_vat NUMERIC,
  vat_code TEXT, vat_rate NUMERIC, vat_amount NUMERIC, vat_treatment TEXT,
  raw JSONB,
  PRIMARY KEY (instance_id, price_list_id, ord)
);
CREATE INDEX IF NOT EXISTS price_list_items_exam_idx ON synclab.price_list_items (instance_id, price_list_id, exam_code);

CREATE TABLE IF NOT EXISTS synclab.requests (
  instance_id TEXT NOT NULL, id TEXT NOT NULL,
  request_number TEXT, date DATE, client_id TEXT, client_code TEXT, operating_company TEXT, state INT, patient_type TEXT,
  occupational_medicine BOOLEAN, created_at_local TIMESTAMP, modified_at_local TIMESTAMP, booking_at_local TIMESTAMP, report_at_local TIMESTAMP,
  source_amount NUMERIC, header_discount_percent NUMERIC,
  dem_age_years INT, dem_sex TEXT, dem_city TEXT, dem_province TEXT, dem_postal_code TEXT,
  -- proiezione opt-in (include_patient): vuote nella proiezione standard
  patient_id TEXT, patient_last_name TEXT, patient_first_name TEXT, patient_birth_date DATE, patient_fiscal_code TEXT,
  invoice_ids TEXT[],
  raw JSONB,   -- testata senza figli
  revision TEXT, disponibilita TEXT NOT NULL DEFAULT 'ATTIVO', disponibilita_reason TEXT, captured_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  PRIMARY KEY (instance_id, id)
);
CREATE INDEX IF NOT EXISTS requests_date_idx ON synclab.requests (date);
CREATE INDEX IF NOT EXISTS requests_client_idx ON synclab.requests (instance_id, client_id);
CREATE TABLE IF NOT EXISTS synclab.request_items (
  instance_id TEXT NOT NULL, request_id TEXT NOT NULL, ord INT NOT NULL, id TEXT,
  exam_id TEXT, exam_code TEXT, description TEXT, historical_description TEXT,
  quantity NUMERIC, gross_unit_price_excluding_vat NUMERIC, discount_percent NUMERIC, net_unit_price_excluding_vat NUMERIC,
  vat_code TEXT, vat_rate NUMERIC, vat_amount NUMERIC, vat_treatment TEXT,
  deleted BOOLEAN, not_performed_code INT, report_ready BOOLEAN, executed_at_local TIMESTAMP, validated_at_local TIMESTAMP,
  invoice_ids TEXT[], sample_ids TEXT[],
  raw JSONB,
  PRIMARY KEY (instance_id, request_id, ord)
);
CREATE INDEX IF NOT EXISTS request_items_exam_idx ON synclab.request_items (exam_code);
CREATE TABLE IF NOT EXISTS synclab.samples (
  instance_id TEXT NOT NULL, request_id TEXT NOT NULL, ord INT NOT NULL, id TEXT,
  barcode TEXT, material TEXT, container TEXT, sample_at_local TIMESTAMP, collected_at_local TIMESTAMP, checked_in_at_local TIMESTAMP,
  prepared_at_local TIMESTAMP, checked_out_at_local TIMESTAMP,
  raw JSONB,
  PRIMARY KEY (instance_id, request_id, ord)
);

CREATE TABLE IF NOT EXISTS synclab.invoices (
  instance_id TEXT NOT NULL, id TEXT NOT NULL,
  invoice_number TEXT, source TEXT, document_type TEXT, source_document_type TEXT, cancelled BOOLEAN, proforma BOOLEAN, state INT,
  date DATE, competence_from DATE, competence_to DATE, client_id TEXT, operating_company TEXT, vat_register TEXT,
  source_gross_taxable_amount NUMERIC, discount_percent NUMERIC, net_taxable_amount NUMERIC, vat_amount NUMERIC, stamp_duty NUMERIC,
  pension_contribution NUMERIC, transport_amount NUMERIC, total NUMERIC, net_revenue_contribution NUMERIC,
  request_ids TEXT[],
  raw JSONB,   -- testata senza righe
  revision TEXT, disponibilita TEXT NOT NULL DEFAULT 'ATTIVO', disponibilita_reason TEXT, captured_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ,
  PRIMARY KEY (instance_id, id)
);
CREATE INDEX IF NOT EXISTS invoices_date_idx ON synclab.invoices (date);
CREATE INDEX IF NOT EXISTS invoices_client_idx ON synclab.invoices (instance_id, client_id);
CREATE TABLE IF NOT EXISTS synclab.invoice_items (
  instance_id TEXT NOT NULL, invoice_id TEXT NOT NULL, ord INT NOT NULL, id TEXT,
  code TEXT, description TEXT, request_id TEXT, request_item_id TEXT, parent_code TEXT, prescription_id INT,
  quantity NUMERIC, source_unit_price_excluding_vat NUMERIC, source_amount_excluding_vat NUMERIC, discount_percent NUMERIC,
  net_amount_excluding_vat NUMERIC, vat_code TEXT, vat_rate NUMERIC, vat_amount NUMERIC, source_vat_amount NUMERIC, vat_treatment TEXT,
  competence_date DATE,
  raw JSONB,
  PRIMARY KEY (instance_id, invoice_id, ord)
);

-- ------------------------------------------------------------------ ponti (relazioni 0..N, anche verso record non ancora arrivati)
-- lato = chi ha dichiarato il legame: REQUEST (request.invoiceIds) o INVOICE (invoice.requestIds). Ogni upsert sostituisce solo i suoi.
CREATE TABLE IF NOT EXISTS synclab.request_invoices (
  instance_id TEXT NOT NULL, request_id TEXT NOT NULL, invoice_id TEXT NOT NULL, lato TEXT NOT NULL CHECK (lato IN ('REQUEST','INVOICE')),
  PRIMARY KEY (instance_id, request_id, invoice_id, lato)
);
CREATE INDEX IF NOT EXISTS request_invoices_inv_idx ON synclab.request_invoices (instance_id, invoice_id);
CREATE TABLE IF NOT EXISTS synclab.request_item_invoices (
  instance_id TEXT NOT NULL, request_id TEXT NOT NULL, item_id TEXT NOT NULL, invoice_id TEXT NOT NULL,
  PRIMARY KEY (instance_id, request_id, item_id, invoice_id)
);
CREATE TABLE IF NOT EXISTS synclab.request_item_samples (
  instance_id TEXT NOT NULL, request_id TEXT NOT NULL, item_id TEXT NOT NULL, sample_id TEXT NOT NULL,
  PRIMARY KEY (instance_id, request_id, item_id, sample_id)
);

-- ------------------------------------------------------------------ abbinamento client Synclab ↔ Legal entity e sede della Suite
-- Riga presente = scelta salvata: organization_id confermato (fonte AUTO = proposta automatica confermata, MANUALE = scelta a mano),
-- perimetro_b2b forzato (TRUE/FALSE) o NULL = calcolato.
CREATE TABLE IF NOT EXISTS synclab.client_map (
  instance_id     TEXT NOT NULL,
  client_id       TEXT NOT NULL,
  organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  site_id         INT REFERENCES public.sites(id) ON DELETE SET NULL,
  fonte           TEXT CHECK (fonte IN ('AUTO','MANUALE')),
  perimetro_b2b   BOOLEAN,
  note            TEXT,
  updated_by      INT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, client_id)
);

-- Proposta automatica e perimetro B2B (regola in docs/SYNCLAB_DATA_API.md, da confermare con il CEO):
--  1. clientCode = codice StudioLAB di una sede della Suite (stessa regola di retail/lib/b2b.js orgDaCodice) → Legal entity della sede;
--  2. altrimenti P.IVA o codice fiscale del client = P.IVA / codice fiscale di UNA sola Legal entity;
--  3. altrimenti da abbinare a mano.
-- perimetro B2B calcolato = Legal entity CLIENTE attiva con livello ATTIVO o CONTRATTUALIZZATO (public.cliente_livello, che legge
-- clienti_attivi_v del Business Hub senza dipendere dalla vista); quello forzato a mano prevale. occupationalMedicine NON entra.
CREATE OR REPLACE VIEW synclab.clients_td AS
WITH base AS (
  SELECT c.instance_id, c.id AS client_id, c.client_code, c.legal_name, c.active, c.operating_company, c.vat_number, c.fiscal_code,
         c.disponibilita, c.price_list_id, c.extra_price_list_id,
         nullif(regexp_replace(upper(coalesce(c.vat_number, '')), '[^0-9A-Z]', '', 'g'), '') AS piva_n,
         nullif(regexp_replace(upper(coalesce(c.fiscal_code, '')), '[^0-9A-Z]', '', 'g'), '') AS cf_n
    FROM synclab.clients c
)
SELECT b.instance_id, b.client_id, b.client_code, b.legal_name, b.active, b.operating_company, b.vat_number, b.fiscal_code, b.disponibilita,
       b.price_list_id, b.extra_price_list_id,
       ps.org_id AS org_proposta_id, ps.site_id AS site_proposta_id,
       CASE WHEN ps.org_id IS NOT NULL THEN 'CODICE_STUDIOLAB' WHEN pf.org_id IS NOT NULL THEN 'PARTITA_IVA' END AS regola_proposta,
       coalesce(ps.org_id, pf.org_id) AS org_auto_id,
       m.organization_id AS org_confermata_id, m.site_id AS site_confermata_id, m.fonte, m.perimetro_b2b AS perimetro_forzato, m.note,
       coalesce(m.organization_id, ps.org_id, pf.org_id) AS organization_id,
       coalesce(m.site_id, CASE WHEN m.organization_id IS NULL OR m.organization_id = ps.org_id THEN ps.site_id END) AS site_id,
       CASE WHEN m.organization_id IS NOT NULL THEN CASE WHEN m.fonte = 'MANUALE' THEN 'MANUALE' ELSE 'CONFERMATO' END
            WHEN coalesce(ps.org_id, pf.org_id) IS NOT NULL THEN 'PROPOSTO' ELSE 'DA_ABBINARE' END AS stato_abbinamento,
       (o.id IS NOT NULL AND o.kind = 'CLIENTE' AND o.active AND public.cliente_livello(o.id) IN ('ATTIVO','CONTRATTUALIZZATO')) AS perimetro_calcolato,
       coalesce(m.perimetro_b2b, (o.id IS NOT NULL AND o.kind = 'CLIENTE' AND o.active AND public.cliente_livello(o.id) IN ('ATTIVO','CONTRATTUALIZZATO'))) AS perimetro_b2b
  FROM base b
  LEFT JOIN synclab.client_map m ON m.instance_id = b.instance_id AND m.client_id = b.client_id
  LEFT JOIN LATERAL (
    SELECT s.organization_id AS org_id, s.id AS site_id FROM public.sites s
     WHERE b.client_code IS NOT NULL AND lower(s.studiolab_code) = lower(b.client_code) AND s.organization_id IS NOT NULL
     ORDER BY s.active DESC, (s.kind = 'SERVICE') DESC, s.id LIMIT 1) ps ON TRUE
  LEFT JOIN LATERAL (
    SELECT CASE WHEN count(*) = 1 THEN min(o2.id) END AS org_id FROM public.organizations o2
     WHERE (b.piva_n IS NOT NULL AND b.piva_n !~ '^0+$' AND regexp_replace(upper(coalesce(o2.vat_number, '')), '[^0-9A-Z]', '', 'g') = b.piva_n)
        OR (b.cf_n IS NOT NULL AND b.cf_n !~ '^0+$' AND (upper(coalesce(o2.tax_code, '')) = b.cf_n OR regexp_replace(upper(coalesce(o2.vat_number, '')), '[^0-9A-Z]', '', 'g') = b.cf_n))) pf ON TRUE
  LEFT JOIN public.organizations o ON o.id = coalesce(m.organization_id, ps.org_id, pf.org_id);

-- Rapporto in audit_log (solo conteggi)
INSERT INTO audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', '052_synclab_data_api.sql', 'Synclab Data API v1: schema synclab (copia locale in sola lettura, stato di sincronizzazione)',
       jsonb_build_object('ambiti', (SELECT count(*) FROM synclab.sync_scope), 'clienti', (SELECT count(*) FROM synclab.clients))
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'MIGRAZIONE_RAPPORTO' AND entity_id = '052_synclab_data_api.sql');
