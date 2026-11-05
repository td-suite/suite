-- Set dimostrativo marcato riga per riga (debug pre-produzione del 05/11/2026, A1): "Rimuovi dati dimostrativi" cancella solo le righe
-- con demo = TRUE (o le vendite con source DEMO), mai campagne, promozioni, clienti, orari, dotazioni, budget e note reali.
ALTER TABLE products       ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE promotions     ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE campaigns      ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE customers      ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE exposure_items ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE site_hours     ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE site_assets    ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE working_days   ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE budgets        ADD COLUMN IF NOT EXISTS demo BOOLEAN NOT NULL DEFAULT FALSE;

-- Righe di un set dimostrativo caricato prima di questa migrazione, riconoscibili con certezza: prestazioni con source DEMO e
-- clienti fittizi (codici D100000+ e S500+ con email @example.org generati da lib/demo.js). Il resto resta non demo: nel dubbio
-- non si cancella.
UPDATE products SET demo = TRUE WHERE source = 'DEMO' AND NOT demo;
UPDATE customers SET demo = TRUE
 WHERE NOT demo AND email LIKE '%@example.org'
   AND ((kind = 'B2C' AND source IN ('GIPO','TUOTEMPO') AND external_id ~ '^D1[0-9]{5}$')
     OR (kind = 'B2B' AND source = 'STUDIOLAB' AND external_id ~ '^S5[0-9]{2}$'));
