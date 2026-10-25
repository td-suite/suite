INSERT INTO app_settings (key, value) VALUES ('daily_alerts_enabled', 'true') ON CONFLICT (key) DO NOTHING;
-- Richiesta di Francesco del 24/10/2026: niente più avviso quotidiano sulle scorte di kit
UPDATE app_settings SET value='0' WHERE key='alert_stock_min';
