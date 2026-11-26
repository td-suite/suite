-- Public Affairs v0.99.3 (CEO, 26/11/2026): "basta una lettura al giorno, la sera alle 17". Le fonti si leggono una volta al giorno
-- all'ora di ora_lettura (17, ora di Roma) invece che ogni 6 ore; l'email del giorno parte dopo quella lettura. Una tantum: porta
-- anche l'ora dell'email alle 17 (resta modificabile nelle Impostazioni). Idempotente.
INSERT INTO impostazioni (key, value) VALUES ('ora_lettura', '17'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO impostazioni (key, value)
SELECT 'ora_invio', '17'::jsonb WHERE NOT EXISTS (SELECT 1 FROM impostazioni WHERE key = 'lettura_quotidiana_impostata')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
INSERT INTO impostazioni (key, value) VALUES ('lettura_quotidiana_impostata', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;
