-- v0.91.1 (CEO, 20/11/2026): "i nomi devono figurare per tutte le accettazioni a prescindere dalla data di accettazione".
-- La conservazione delle identità passa al massimo (3.650 giorni) anche dove era stata scelta una durata più breve. Idempotente.
-- Sostituisce la decisione del 10/11/2026 ("identità solo per gli ultimi giorni"). Il codice fiscale continua a non essere salvato.
INSERT INTO impostazioni (key, value) VALUES ('giorni_identita', '3650'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = '3650'::jsonb WHERE (impostazioni.value #>> '{}')::numeric < 3650;
