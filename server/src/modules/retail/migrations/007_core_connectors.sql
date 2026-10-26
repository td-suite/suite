-- Connettori unici della Suite (docs/CONNETTORI.md, 26/10/2026): credenziali, base URL e impostazioni di accesso stanno in
-- public.connectors e si configurano in Amministrazione > Connettori. La riga retail.connectors resta per pianificazione ed esiti
-- delle sincronizzazioni. core_migrated_at segna la copia una tantum delle credenziali dell'app di origine nel core
-- (fatta in JS all'avvio del modulo, lib/connectors.js migrateCredentialsToCore, perché va ricifrata con lib/secrets della Suite).
ALTER TABLE connectors ADD COLUMN IF NOT EXISTS core_migrated_at TIMESTAMPTZ;
-- Le tre righe del modulo (pianificazione ed esiti delle sincronizzazioni) esistono sempre: l'app di origine le creava a runtime
INSERT INTO connectors (kind, enabled, auth_kind, schedule, settings, core_migrated_at) VALUES
  ('GIPO', FALSE, 'API_KEY', 'MANUALE', '{"sync_days":30,"note":"Accettazioni e prenotazioni B2C: export da file finché Docplanner non attiva le API."}'::jsonb, now()),
  ('TUOTEMPO', FALSE, 'API_KEY', 'DAILY', '{}'::jsonb, now()),
  ('STUDIOLAB', FALSE, 'API_KEY', 'MANUALE', '{"sync_days":30,"note":"Accettazioni B2B: export da file finché CB Sistemi non attiva un web service di reportistica."}'::jsonb, now())
ON CONFLICT (kind) DO NOTHING;
