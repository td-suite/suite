-- v0.68.6 (CEO, 10/11/2026: "C'è una discrepanza tra il valore dell'accettato di StudioLab a ieri e quello del Cockpit o comunque della
-- Suite. Trovare l'errore e correggere."). La produzione dei cruscotti diventa l'ACCETTATO, come il report "Riepilogo Esami" del gestionale:
--  - synclab.stati_erogati(): predefinito = tutti gli stati inclusi dal gestionale tranne 11 (NC mai arrivato): 10, 15, 18, 20, 25, 30, 40, 50.
--    La chiave dell'impostazione resta `stati_erogati` (etichetta "Stati che contano come produzione accettata"), modificabile.
--  - il valore salvato nel connettore passa al nuovo predefinito SOLO se è ancora il vecchio predefinito (18, 20, 25, 40, 50): una scelta
--    diversa fatta a mano non si tocca.
--  - synclab.sconto_testata_applicato(): impostazione `sconto_testata` (APPLICA | NON_APPLICARE, predefinita NON_APPLICARE = importi di
--    riga come il report del gestionale). La usa la Diagnostica (D51) e chi interroga la copia in SQL; il codice JS la legge con
--    scontoTestata() di lib/synclab/letture.js.
-- Idempotente (CREATE OR REPLACE, UPDATE condizionato, rapporto scritto una volta).
CREATE OR REPLACE FUNCTION synclab.stati_erogati() RETURNS int[] LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT array_agg(DISTINCT (x #>> '{}')::int ORDER BY (x #>> '{}')::int)
       FROM public.connectors c, jsonb_array_elements(CASE WHEN jsonb_typeof(c.settings->'stati_erogati') = 'array' THEN c.settings->'stati_erogati' ELSE '[]'::jsonb END) x
      WHERE c.kind = 'STUDIOLAB' AND (x #>> '{}') ~ '^[0-9]{1,3}$'),
    ARRAY[10, 15, 18, 20, 25, 30, 40, 50]);
$$;

CREATE OR REPLACE FUNCTION synclab.sconto_testata_applicato() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT upper(trim(c.settings->>'sconto_testata')) = 'APPLICA' FROM public.connectors c WHERE c.kind = 'STUDIOLAB' LIMIT 1), FALSE);
$$;

-- rapporto PRIMA dell'aggiornamento (valore trovato), una volta sola
INSERT INTO audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', '056_produzione_accettata.sql',
       'Produzione accettata (Synclab): stati predefiniti 10, 15, 18, 20, 25, 30, 40, 50 (tutti tranne 11); sconto di testata non applicato salvo impostazione',
       jsonb_build_object('stati_salvati', (SELECT c.settings->'stati_erogati' FROM public.connectors c WHERE c.kind = 'STUDIOLAB' LIMIT 1),
                          'sconto_testata_salvato', (SELECT c.settings->'sconto_testata' FROM public.connectors c WHERE c.kind = 'STUDIOLAB' LIMIT 1),
                          'portato_al_nuovo_predefinito', coalesce((SELECT jsonb_typeof(c.settings->'stati_erogati') = 'array'
                              AND (SELECT array_agg(DISTINCT (x #>> '{}')::int ORDER BY (x #>> '{}')::int) FROM jsonb_array_elements(c.settings->'stati_erogati') x WHERE (x #>> '{}') ~ '^[0-9]{1,3}$') = ARRAY[18, 20, 25, 40, 50]
                            FROM public.connectors c WHERE c.kind = 'STUDIOLAB' LIMIT 1), FALSE))
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'MIGRAZIONE_RAPPORTO' AND entity_id = '056_produzione_accettata.sql');

-- vecchio predefinito salvato → nuovo predefinito (qualunque ordine o duplicato dei codici); ogni altro valore resta com'è
UPDATE public.connectors c SET settings = jsonb_set(c.settings, '{stati_erogati}', '[10, 15, 18, 20, 25, 30, 40, 50]'::jsonb), updated_at = now()
 WHERE c.kind = 'STUDIOLAB' AND jsonb_typeof(c.settings->'stati_erogati') = 'array'
   AND (SELECT array_agg(DISTINCT (x #>> '{}')::int ORDER BY (x #>> '{}')::int) FROM jsonb_array_elements(c.settings->'stati_erogati') x WHERE (x #>> '{}') ~ '^[0-9]{1,3}$') = ARRAY[18, 20, 25, 40, 50];
