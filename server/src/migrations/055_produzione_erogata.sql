-- v0.68.5 (CEO, 10/11/2026): la grandezza che conta è la PRODUZIONE EROGATA (accettazioni in stato erogato), non il fatturato dei
-- documenti. Definizione unica in server/src/lib/synclab/letture.js (produzioneErogata); qui solo gli appoggi SQL condivisi:
--  - synclab.stati_erogati(): codici di stato dell'accettazione considerati "erogati", dall'impostazione del connettore StudioLAB
--    `stati_erogati` (Dati Synclab > Impostazioni); predefiniti 18, 20, 25, 40, 50 (dal prelievo eseguito in poi; esclusi 10 prenotata,
--    11 NC mai arrivato, 15 in attesa, 30 attende prelievo). IPOTESI DA CONFERMARE con il CEO e CB Sistemi (docs/SYNCLAB_DATA_API.md).
--    La usano la Diagnostica (D51) e chi interroga la copia in SQL; il codice JS la legge con statiErogati().
--  - indice per data e stato delle accettazioni (letture giornaliere del Cockpit, aggiornate ogni ora di giorno).
-- Idempotente.
CREATE OR REPLACE FUNCTION synclab.stati_erogati() RETURNS int[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT array_agg(DISTINCT (x #>> '{}')::int ORDER BY (x #>> '{}')::int)
       FROM public.connectors c, jsonb_array_elements(CASE WHEN jsonb_typeof(c.settings->'stati_erogati') = 'array' THEN c.settings->'stati_erogati' ELSE '[]'::jsonb END) x
      WHERE c.kind = 'STUDIOLAB' AND (x #>> '{}') ~ '^[0-9]{1,3}$'),
    ARRAY[18, 20, 25, 40, 50]);
$$;

CREATE INDEX IF NOT EXISTS requests_date_state_idx ON synclab.requests (date, state);
CREATE INDEX IF NOT EXISTS requests_client_date_idx ON synclab.requests (instance_id, client_id, date);

INSERT INTO audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', '055_produzione_erogata.sql', 'Produzione erogata (Synclab): stati erogati dall''impostazione del connettore, indici per data e stato',
       jsonb_build_object('stati_erogati', to_jsonb(synclab.stati_erogati()), 'accettazioni', (SELECT count(*) FROM synclab.requests))
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'MIGRAZIONE_RAPPORTO' AND entity_id = '055_produzione_erogata.sql');
