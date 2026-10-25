-- Anagrafica unica (docs/ANAGRAFICA.md), seconda parte: le aziende di Cash (società titolari delle sedi) sono le
-- organizzazioni della Suite (public.organizations con kind SOCIETA o GRUPPO). La tabella companies sparisce; restano in
-- org_ext i soli campi Cash dell'azienda: carta intestata e logo della distinta, IBAN di versamento, riferimenti SEPA,
-- capofila (is_franchisor). I conti correnti restano in company_bank_accounts, agganciati a public.organizations.

DROP TABLE IF EXISTS companies CASCADE;

CREATE TABLE org_ext (
  org_id            INT PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  letterhead_footer TEXT,
  logo              BYTEA,
  logo_mime         TEXT,
  iban              TEXT,
  bic               TEXT,
  sepa_mandate_id   TEXT,
  sepa_mandate_date DATE,
  sepa_first_done   BOOLEAN NOT NULL DEFAULT FALSE,
  is_franchisor     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chiavi esterne verso l'anagrafica unica (il DROP CASCADE le ha tolte)
ALTER TABLE users                 ADD CONSTRAINT users_company_id_fkey                 FOREIGN KEY (company_id) REFERENCES public.organizations(id);
ALTER TABLE site_ext              ADD CONSTRAINT site_ext_company_id_fkey              FOREIGN KEY (company_id) REFERENCES public.organizations(id);
ALTER TABLE payment_transactions  ADD CONSTRAINT payment_transactions_company_id_fkey  FOREIGN KEY (company_id) REFERENCES public.organizations(id);
ALTER TABLE channel_revenues      ADD CONSTRAINT channel_revenues_company_id_fkey      FOREIGN KEY (company_id) REFERENCES public.organizations(id);
ALTER TABLE nonconformities       ADD CONSTRAINT nonconformities_company_id_fkey       FOREIGN KEY (company_id) REFERENCES public.organizations(id);
ALTER TABLE royalty_contracts     ADD CONSTRAINT royalty_contracts_company_id_fkey     FOREIGN KEY (company_id) REFERENCES public.organizations(id);
ALTER TABLE royalty_statements    ADD CONSTRAINT royalty_statements_company_id_fkey    FOREIGN KEY (company_id) REFERENCES public.organizations(id);
ALTER TABLE cash_deposits         ADD CONSTRAINT cash_deposits_company_id_fkey         FOREIGN KEY (company_id) REFERENCES public.organizations(id);
ALTER TABLE email_log             ADD CONSTRAINT email_log_company_id_fkey             FOREIGN KEY (company_id) REFERENCES public.organizations(id);
ALTER TABLE company_bank_accounts ADD CONSTRAINT company_bank_accounts_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Vista con le colonne che il codice dell'app si aspetta dalla vecchia tabella companies: tutte le società e i gruppi
-- dell'anagrafica (anche senza impostazioni Cash), con i campi Cash da org_ext.
CREATE VIEW companies_v AS
  SELECT o.id, coalesce(o.code, 'ORG' || o.id) AS code, o.name, o.kind, o.vat_number, o.tax_code, o.address, o.zip, o.city, o.province,
         o.phone, o.email, o.pec, o.website, o.active,
         (x.org_id IS NOT NULL) AS configured, x.letterhead_footer, x.logo, x.logo_mime, x.iban, x.bic, x.sepa_mandate_id, x.sepa_mandate_date,
         coalesce(x.sepa_first_done, FALSE) AS sepa_first_done, coalesce(x.is_franchisor, FALSE) AS is_franchisor,
         o.created_at, coalesce(x.updated_at, o.updated_at) AS updated_at
    FROM public.organizations o LEFT JOIN org_ext x ON x.org_id = o.id
   WHERE o.kind IN ('SOCIETA', 'GRUPPO');

-- La vista sites_v resta valida: site_ext.company_id ora è l'id dell'organizzazione.
