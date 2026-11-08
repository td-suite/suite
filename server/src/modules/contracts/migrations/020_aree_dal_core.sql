-- Programma "anagrafica unica", blocco 3 (08/11/2026), B8: le aree del modulo Contratti del personale sono le unità di primo livello
-- dell'organigramma del core (figlie della radice in Amministrazione > Organizzazione). Ogni area si collega all'unità del core con lo
-- stesso nome (areas.core_unit_id); le altre restano senza collegamento ed escono nel rapporto (si decide in Organizzazione se crearle
-- o spostare le persone). Non distruttiva: nessuna area eliminata, nessuna persona spostata; l'organigramma proprio del modulo
-- (org_units) resta in sola lettura (le sue route di scrittura rispondono 410).
ALTER TABLE areas ADD COLUMN IF NOT EXISTS core_unit_id INT REFERENCES public.org_units(id) ON DELETE SET NULL;
CREATE TEMP TABLE IF NOT EXISTS _c020 (voce TEXT, dettaglio JSONB) ON COMMIT DROP;
WITH primo AS (
  SELECT u.id, u.name FROM public.org_units u WHERE u.active AND u.parent_id IN (SELECT r.id FROM public.org_units r WHERE r.parent_id IS NULL)
), m AS (
  UPDATE areas a SET core_unit_id = p.id FROM primo p
   WHERE a.core_unit_id IS NULL AND lower(unaccent(trim(a.name))) = lower(unaccent(trim(p.name)))
     AND NOT EXISTS (SELECT 1 FROM areas x WHERE x.core_unit_id = p.id)
  RETURNING a.id, a.name, p.id AS core_unit_id)
INSERT INTO _c020 SELECT 'aree_collegate', coalesce(jsonb_agg(jsonb_build_object('area', name, 'area_id', id, 'core_unit_id', core_unit_id)), '[]'::jsonb) FROM m;
INSERT INTO _c020 SELECT 'aree_senza_unita_del_core', coalesce(jsonb_agg(jsonb_build_object('area', a.name, 'area_id', a.id, 'livello', a.level,
         'persone', (SELECT count(*) FROM resources_v r WHERE r.area_id = a.id))), '[]'::jsonb) FROM areas a WHERE a.core_unit_id IS NULL;
INSERT INTO _c020 SELECT 'unita_di_primo_livello_senza_area', coalesce(jsonb_agg(jsonb_build_object('unita', u.name, 'id', u.id)), '[]'::jsonb)
  FROM public.org_units u WHERE u.active AND u.parent_id IN (SELECT r.id FROM public.org_units r WHERE r.parent_id IS NULL) AND NOT EXISTS (SELECT 1 FROM areas a WHERE a.core_unit_id = u.id);
INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'contracts/020_aree_dal_core.sql', 'Contratti del personale: aree = unità di primo livello dell''organigramma (B8)', jsonb_object_agg(voce, dettaglio) FROM _c020;
