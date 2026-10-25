-- Catalogo StudioLab (Tabella esami) e distinta base (costi) per il margine B2C e B2B
ALTER TABLE products ALTER COLUMN cost TYPE NUMERIC(10,4);
ALTER TABLE products ADD COLUMN sector TEXT;                 -- settore StudioLab (CodiceSettore): ANALISI, MICROBIOLOGIA, ANATOMIA PATOLOGICA, GENETICA...
ALTER TABLE products ADD COLUMN sector_clinical TEXT;        -- CodiceSettoreClinico: ISTOLOGIA, PATOLOGIA CLINICA, EMATOLOGIA E COAGULAZIONE...
ALTER TABLE products ADD COLUMN destination TEXT;            -- strumento o service esterno (Alinity, Bianalisi, Cerba, Istologia...)
ALTER TABLE products ADD COLUMN price_mdl NUMERIC(10,2);     -- listino medicina del lavoro
ALTER TABLE products ADD COLUMN price_service NUMERIC(10,2); -- listino service (laboratori terzi)
ALTER TABLE products ADD COLUMN cost_service NUMERIC(10,4);  -- quota del costo dovuta al service esterno
ALTER TABLE products ADD COLUMN cost_source TEXT;            -- DISTINTA | TABELLA | MANUALE
ALTER TABLE products ADD COLUMN cost_updated_at TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN is_vet BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN exclude_from_counts BOOLEAN NOT NULL DEFAULT FALSE; -- voci tecniche (es. IND indice di siero) escluse dal conteggio esami
CREATE INDEX products_sector_idx ON products (sector);
UPDATE products SET exclude_from_counts = TRUE WHERE upper(code) = 'IND';

-- Paziente finale delle vendite B2B: sesso e data di nascita (dal codice fiscale o dall'export) per profilare senza creare clienti B2C
ALTER TABLE sales ADD COLUMN patient_sex TEXT;
ALTER TABLE sales ADD COLUMN patient_birth_date DATE;
