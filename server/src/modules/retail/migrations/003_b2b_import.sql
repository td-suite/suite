-- Import B2B (StudioLab): riferimento paziente senza creare anagrafiche B2C, numero fattura, gruppo cliente, clienti interni
ALTER TABLE sales ADD COLUMN patient_ref TEXT;      -- identificativo del paziente finale (cognome nome data di nascita o CF) per contare i pazienti distinti dei clienti B2B
ALTER TABLE sales ADD COLUMN invoice_ref TEXT;      -- numero fattura del gestionale (vuoto = non ancora fatturato)
CREATE INDEX sales_invoice_idx ON sales (invoice_ref) WHERE invoice_ref IS NOT NULL;
ALTER TABLE customers ADD COLUMN group_name TEXT;   -- gruppo per i clienti B2B con più reparti/sedi (es. Casa di Cura Villa Fiorita)
ALTER TABLE customers ADD COLUMN external_code TEXT; -- codice cliente nel gestionale (es. SER0013)
CREATE INDEX customers_group_idx ON customers (group_name) WHERE group_name IS NOT NULL;
