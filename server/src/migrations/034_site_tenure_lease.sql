-- Titolo di godimento e locazione della sede (richiesta del CEO, 31/10/2026): l'anagrafica Sedi è la fonte unica di proprietà /
-- locazione / comodato / ospitata, del canone con IVA, della durata e delle garanzie date al locatore (fideiussione bancaria,
-- fideiussione assicurativa, caparra o deposito cauzionale). Payments (finance.lease_contracts) e Facility leggono da qui:
-- lib/leaseSync.js allinea a due versi l'anagrafica e il contratto dello Scadenziario strutture di Payments.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS tenure TEXT NOT NULL DEFAULT 'LOCAZIONE';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sites_tenure_chk') THEN
    ALTER TABLE sites ADD CONSTRAINT sites_tenure_chk CHECK (tenure IN ('PROPRIETA','LOCAZIONE','COMODATO','OSPITATA'));
  END IF;
END $$;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS rent_amount NUMERIC(12,2) CHECK (rent_amount IS NULL OR rent_amount >= 0);   -- importo della rata
ALTER TABLE sites ADD COLUMN IF NOT EXISTS rent_period TEXT NOT NULL DEFAULT 'MESE' CHECK (rent_period IN ('MESE','TRIMESTRE','SEMESTRE','ANNO'));
ALTER TABLE sites ADD COLUMN IF NOT EXISTS rent_vat TEXT CHECK (rent_vat IS NULL OR rent_vat IN ('PIU_IVA','ESENTE','IVA_INCLUSA'));
ALTER TABLE sites ADD COLUMN IF NOT EXISTS rent_vat_rate NUMERIC(5,2) DEFAULT 22 CHECK (rent_vat_rate IS NULL OR rent_vat_rate BETWEEN 0 AND 100);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lease_start DATE;                     -- decorrenza
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lease_years INT CHECK (lease_years IS NULL OR lease_years BETWEEN 0 AND 99);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lease_renewal_years INT CHECK (lease_renewal_years IS NULL OR lease_renewal_years BETWEEN 0 AND 99);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lease_notice_months INT CHECK (lease_notice_months IS NULL OR lease_notice_months BETWEEN 0 AND 60);
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lease_end DATE;                       -- fine del primo periodo (calcolata se vuota)
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lease_landlord_org_id INT REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS lease_registration TEXT CHECK (lease_registration IS NULL OR lease_registration IN ('IMPOSTA_ANNUALE','UNICA_SOLUZIONE','CEDOLARE_SECCA','DA_REGISTRARE'));
ALTER TABLE sites ADD COLUMN IF NOT EXISTS guarantee_bank_amount NUMERIC(12,2) CHECK (guarantee_bank_amount IS NULL OR guarantee_bank_amount >= 0);           -- fideiussione bancaria
ALTER TABLE sites ADD COLUMN IF NOT EXISTS guarantee_insurance_amount NUMERIC(12,2) CHECK (guarantee_insurance_amount IS NULL OR guarantee_insurance_amount >= 0); -- fideiussione assicurativa
ALTER TABLE sites ADD COLUMN IF NOT EXISTS deposit_amount NUMERIC(12,2) CHECK (deposit_amount IS NULL OR deposit_amount >= 0);                         -- caparra / deposito cauzionale
ALTER TABLE sites ADD COLUMN IF NOT EXISTS guarantee_notes TEXT;
CREATE INDEX IF NOT EXISTS sites_landlord_idx ON sites (lease_landlord_org_id);

-- Documenti della sede: il contratto di locazione in PDF (fonte unica del file). Archivio a due vie (lib/moduleStorage.js): bytea nel
-- database oppure percorso nel blob della Suite. `extracted` è il JSON letto da Claude (dati del contratto, nessun dato di paziente).
-- Payments lo vede come documento del contratto: finance.lease_documents.site_document_id punta qui (riga senza byte, nessuna copia).
CREATE TABLE IF NOT EXISTS site_documents (
  id            SERIAL PRIMARY KEY,
  site_id       INT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL DEFAULT 'CONTRATTO_LOCAZIONE' CHECK (kind IN ('CONTRATTO_LOCAZIONE','ALTRO')),
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL DEFAULT 'application/pdf',
  size          INT NOT NULL,
  sha256        TEXT NOT NULL,
  data          BYTEA,
  blob_path     TEXT,
  extracted     JSONB,
  extracted_at  TIMESTAMPTZ,
  model         TEXT,
  text_chars    INT,
  ocr           BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_documents_site_idx ON site_documents (site_id, kind, created_at DESC);

-- Recupero: OSPITATA dove c'è la Legal entity ospitante; LOCAZIONE (con i dati del contratto) dove Payments ha un contratto attivo;
-- le altre restano LOCAZIONE da verificare in Amministrazione > Sedi (needs_review non si tocca).
UPDATE sites SET tenure = 'OSPITATA' WHERE host_organization_id IS NOT NULL;
DO $$ BEGIN
  IF to_regclass('finance.lease_contracts') IS NOT NULL AND to_regclass('finance.lease_steps') IS NOT NULL THEN
    UPDATE sites s SET tenure = 'LOCAZIONE',
        rent_amount = coalesce(s.rent_amount, (SELECT st.amount FROM finance.lease_steps st WHERE st.lease_id = l.id ORDER BY (st.reason = 'INIZIALE') DESC, st.valid_from LIMIT 1)),
        rent_period = CASE l.period_months WHEN 3 THEN 'TRIMESTRE' WHEN 6 THEN 'SEMESTRE' WHEN 12 THEN 'ANNO' ELSE 'MESE' END,
        lease_start = coalesce(s.lease_start, l.start_date), lease_years = coalesce(s.lease_years, l.first_term_years),
        lease_renewal_years = coalesce(s.lease_renewal_years, l.renewal_years), lease_notice_months = coalesce(s.lease_notice_months, l.notice_months),
        lease_landlord_org_id = coalesce(s.lease_landlord_org_id, l.landlord_org_id), lease_registration = coalesce(s.lease_registration, l.registration),
        deposit_amount = coalesce(s.deposit_amount, l.deposit)
      FROM (SELECT DISTINCT ON (site_id) * FROM finance.lease_contracts WHERE active ORDER BY site_id, start_date DESC, id DESC) l
     WHERE l.site_id = s.id AND s.host_organization_id IS NULL;
  END IF;
END $$;
UPDATE sites SET lease_end = (lease_start + make_interval(years => lease_years))::date WHERE lease_end IS NULL AND lease_start IS NOT NULL AND lease_years IS NOT NULL;
