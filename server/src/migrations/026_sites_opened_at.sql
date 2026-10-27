-- Impostazioni senza doppia compilazione (richiesta del CEO, 27/10/2026, docs/IMPOSTAZIONI.md): i moduli non chiedono dati
-- che l'anagrafica unica o le impostazioni generali hanno già. Tre dati finora copiati nei moduli passano nel core:
-- 1. sites.opened_at: data di apertura della sede (Cash site_ext.start_date e Retail site_ext.opened_at erano lo stesso dato).
-- 2. organizations.iban / bic / bank_name: coordinate bancarie della Legal entity (Business org_ext.iban/bank_name e Cash
--    org_ext.iban/bic erano copie). I moduli le leggono da qui; le loro migrazioni riportano i valori esistenti e tolgono le colonne.
-- 3. app_settings.company: dati aziendali di Toscana Diagnostica (ragione sociale, sede, P.IVA, REA, capitale, contatti,
--    Direttore Sanitario, piè di pagina) finora cablati nel codice di business, finance, shipments, circolari, contracts e
--    orgchartExport. Editor in Amministrazione > Impostazioni > Dati aziendali; lettura con getCompany() in lib/company.js.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS opened_at DATE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS iban TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bic TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS bank_name TEXT;

INSERT INTO app_settings (key, value) VALUES ('company', '{
  "name": "Toscana Diagnostica",
  "legal_name": "Toscana Diagnostica S.r.l.",
  "vat": "07528130482",
  "tax_code": "07528130482",
  "rea": "FI-709602",
  "share_capital": "€ 50.000,00 i.v.",
  "address": "Via di Pratignone, 13/4",
  "zip": "50019",
  "city": "Sesto Fiorentino",
  "province": "FI",
  "phone": "055776511",
  "fax": "055776511",
  "email": "info@toscanadiagnostica.it",
  "pec": "toscanadiagnostica@pec.it",
  "website": "www.toscanadiagnostica.it",
  "health_director": "prof. Gian Luigi Taddei",
  "footer": "Via di Pratignone, 13/4, 50019 Sesto Fiorentino (FI). Tel. e Fax: 055776511. Direttore Sanitario: prof. Gian Luigi Taddei.\nP.IVA e C.F.: 07528130482, REA n. FI-709602, Capitale Sociale: € 50.000,00 i.v."
}'::jsonb) ON CONFLICT (key) DO NOTHING;
