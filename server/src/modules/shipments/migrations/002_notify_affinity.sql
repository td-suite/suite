INSERT INTO app_settings (key, value) VALUES ('notify_affinity_on_ship', 'true') ON CONFLICT (key) DO NOTHING;
