-- Anagrafica unica della Suite (docs/ANAGRAFICA.md): le sedi esistono una volta sola in public.sites.
-- La tabella sedi dell'app e le assegnazioni utente/sede spariscono; resta site_ext con i soli campi operativi di Cash.
-- Ogni colonna che referenziava sites ora punta a public.sites(id). Il perimetro degli utenti viene dagli scope del grant Suite.

DROP TABLE IF EXISTS user_sites CASCADE;
DROP TABLE IF EXISTS sites CASCADE;

-- Impostazioni Cash della sede (tutto ciò che le migrazioni 001-009 avevano aggiunto a sites, tranne i dati anagrafici:
-- codice, nome, indirizzo, città, provincia e stato attivo vengono da public.sites)
CREATE TABLE site_ext (
  site_id               INT PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  company_id            INT NOT NULL REFERENCES companies(id),
  cash_float            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (cash_float >= 0),
  operating_days        TEXT NOT NULL DEFAULT '1111110' CHECK (operating_days ~ '^[01]{7}$'),
  pos_terminals         TEXT,
  start_date            DATE NOT NULL DEFAULT CURRENT_DATE,
  ownership             TEXT NOT NULL DEFAULT 'OSPITATA' CHECK (ownership IN ('PROPRIA','OSPITATA')),
  hours                 JSONB NOT NULL DEFAULT '{}'::jsonb,
  hours_note            TEXT,
  expected_registers    INT NOT NULL DEFAULT 1 CHECK (expected_registers BETWEEN 1 AND 20),
  site_email            TEXT,
  host_name             TEXT,
  host_vat              TEXT,
  host_email            TEXT,
  royalty_fixed_monthly NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (royalty_fixed_monthly >= 0),
  royalty_pct           NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (royalty_pct >= 0 AND royalty_pct <= 100),
  royalty_base          TEXT NOT NULL DEFAULT 'TOTALE' CHECK (royalty_base IN ('TOTALE','CONTANTI_POS','CONTANTI')),
  royalty_vat_rate      NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (royalty_vat_rate >= 0 AND royalty_vat_rate <= 100),
  royalty_notes         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX site_ext_company_idx ON site_ext (company_id);

-- Chiavi esterne verso l'anagrafica unica (il DROP CASCADE le ha tolte)
ALTER TABLE cash_float_history       ADD CONSTRAINT cash_float_history_site_id_fkey       FOREIGN KEY (site_id) REFERENCES public.sites(id);
ALTER TABLE cash_reports             ADD CONSTRAINT cash_reports_site_id_fkey             FOREIGN KEY (site_id) REFERENCES public.sites(id);
ALTER TABLE payment_transactions     ADD CONSTRAINT payment_transactions_site_id_fkey     FOREIGN KEY (site_id) REFERENCES public.sites(id);
ALTER TABLE channel_revenues         ADD CONSTRAINT channel_revenues_site_id_fkey         FOREIGN KEY (site_id) REFERENCES public.sites(id);
ALTER TABLE nonconformities          ADD CONSTRAINT nonconformities_site_id_fkey          FOREIGN KEY (site_id) REFERENCES public.sites(id);
ALTER TABLE site_royalty_history     ADD CONSTRAINT site_royalty_history_site_id_fkey     FOREIGN KEY (site_id) REFERENCES public.sites(id);
ALTER TABLE site_royalty_statements  ADD CONSTRAINT site_royalty_statements_site_id_fkey  FOREIGN KEY (site_id) REFERENCES public.sites(id);
ALTER TABLE email_log                ADD CONSTRAINT email_log_site_id_fkey                FOREIGN KEY (site_id) REFERENCES public.sites(id);
ALTER TABLE gipo_sezionali           ADD CONSTRAINT gipo_sezionali_site_id_fkey           FOREIGN KEY (site_id) REFERENCES public.sites(id) ON DELETE SET NULL;

-- Vista con le colonne che il codice dell'app si aspetta dalla vecchia tabella sites: solo le sedi configurate in Cash
-- (con riga in site_ext). Le FK restano su public.sites.
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.address, s.city, s.province, s.active,
         e.company_id, e.cash_float, e.operating_days, e.pos_terminals, e.start_date, e.ownership, e.hours, e.hours_note,
         e.expected_registers, e.site_email, e.host_name, e.host_vat, e.host_email,
         e.royalty_fixed_monthly, e.royalty_pct, e.royalty_base, e.royalty_vat_rate, e.royalty_notes,
         e.created_at, e.updated_at
    FROM public.sites s JOIN site_ext e ON e.site_id = s.id;
