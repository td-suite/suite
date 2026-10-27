-- Impostazioni senza doppia compilazione (richiesta del CEO, 27/10/2026, docs/IMPOSTAZIONI.md). Retail non chiede più dati che
-- l'anagrafica unica ha già:
-- * site_ext.studiolab_code duplicava public.sites.studiolab_code (i valori esistenti completano il core se lì manca);
-- * site_ext.saturday_open derivava dagli orari: ora si calcola da public.sites.opening_hours_json (sabato con almeno una fascia);
-- * site_ext.opened_at è public.sites.opened_at (migrazione core 026; i valori esistenti riportati nel core se mancano);
-- * site_ext.description diventa commercial_description (descrizione commerciale per book e scheda sede: resta, è del modulo);
-- * site_hours: le fasce per giorno (closed, open1..close2) duplicavano opening_hours_json; restano solo le note operative per
--   giorno (es. "prelievi 7:30-10:30"). Le fasce esistenti completano il core dove gli orari strutturati mancano.
-- La vista sites_v espone le stesse colonne (studiolab_code, saturday_open, opened_at) calcolate dal core, più hours_json.

-- ---------- 1. Valori esistenti nel core ----------
UPDATE public.sites s SET opened_at = e.opened_at, updated_at = now() FROM site_ext e WHERE e.site_id = s.id AND s.opened_at IS NULL AND e.opened_at IS NOT NULL;
UPDATE public.sites s SET studiolab_code = e.studiolab_code, updated_at = now() FROM site_ext e WHERE e.site_id = s.id AND s.studiolab_code IS NULL AND e.studiolab_code IS NOT NULL AND e.studiolab_code <> '';
UPDATE public.sites s SET opening_hours_json = h.j, updated_at = now()
  FROM (SELECT site_id, jsonb_object_agg(d, ranges) AS j
          FROM (SELECT site_id, (ARRAY['mon','tue','wed','thu','fri','sat','sun'])[weekday] AS d,
                       (SELECT jsonb_agg(jsonb_build_object('from', to_char(o, 'HH24:MI'), 'to', to_char(c, 'HH24:MI')))
                          FROM (VALUES (open1, close1), (open2, close2)) r(o, c) WHERE o IS NOT NULL AND c IS NOT NULL) AS ranges
                  FROM site_hours WHERE NOT closed) x
         WHERE ranges IS NOT NULL GROUP BY site_id) h
 WHERE h.site_id = s.id AND s.opening_hours_json IS NULL;

-- ---------- 2. Via le copie ----------
DROP VIEW IF EXISTS sites_v;
ALTER TABLE site_ext DROP COLUMN IF EXISTS studiolab_code, DROP COLUMN IF EXISTS saturday_open, DROP COLUMN IF EXISTS opened_at;
ALTER TABLE site_ext RENAME COLUMN description TO commercial_description;
ALTER TABLE site_hours DROP COLUMN IF EXISTS closed, DROP COLUMN IF EXISTS open1, DROP COLUMN IF EXISTS close1, DROP COLUMN IF EXISTS open2, DROP COLUMN IF EXISTS close2;
DELETE FROM site_hours WHERE note IS NULL OR note = '';

-- ---------- 3. Vista con le colonne attese, calcolate dal core ----------
-- saturday_open: sabato con almeno una fascia in anagrafica; senza orari strutturati vale TRUE (predefinito storico di Retail).
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.short_name, s.kind, s.address, s.city, s.province, s.zip, s.lat, s.lng,
         s.manager_name AS manager, s.legacy_brand, s.phone, s.email, s.opening_hours, s.opening_hours_json AS hours_json, s.active, s.sort_order,
         s.organization_id, s.notes AS suite_notes, s.studiolab_code, s.opened_at,
         coalesce(e.in_network, s.kind NOT IN ('HEADQUARTER', 'SERVICE', 'ALTRO')) AS in_network,
         (e.site_id IS NOT NULL) AS configured,
         e.tuotempo_area_id, e.gipo_site_code,
         CASE WHEN s.opening_hours_json IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_each(s.opening_hours_json) d WHERE jsonb_typeof(d.value) = 'array' AND jsonb_array_length(d.value) > 0)
              THEN TRUE ELSE coalesce(jsonb_typeof(s.opening_hours_json->'sat') = 'array' AND jsonb_array_length(s.opening_hours_json->'sat') > 0, FALSE) END AS saturday_open,
         e.catchment_cities,
         e.sqm_waiting, e.surface_sqm, e.rooms, e.boxes, e.parking, e.accessibility, e.services, e.commercial_description,
         e.notes, e.updated_at AS ext_updated_at
    FROM public.sites s LEFT JOIN site_ext e ON e.site_id = s.id;
