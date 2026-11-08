-- Programma "anagrafica unica", blocco 3 (08/11/2026), B4: nella scheda sede di Retail superficie e box prelievo vengono da Facility
-- (facility.properties, public.facility_sede) e il numero di ambulatori da Room Planning (public.ambulatori_room); i valori scritti
-- finora in retail.site_ext restano come riserva quando i moduli non sono avviati (e passano a Facility dove manca il dato, funzione
-- core public.consolida_superfici_in_facility). Non distruttiva: vista ridefinita, nessun dato cancellato.
DROP VIEW IF EXISTS sites_v;
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.short_name, s.kind, s.address, s.city, s.province, s.zip, s.lat, s.lng,
         public.responsabile_sede(s.id) AS manager, s.legacy_brand, s.phone, s.email, s.opening_hours, s.opening_hours_json AS hours_json, s.active, s.sort_order,
         s.organization_id, s.notes AS suite_notes, s.studiolab_code, s.opened_at,
         coalesce(e.in_network, s.kind NOT IN ('HEADQUARTER', 'SERVICE', 'ALTRO')) AS in_network,
         (e.site_id IS NOT NULL) AS configured,
         e.tuotempo_area_id, e.gipo_site_code,
         CASE WHEN s.opening_hours_json IS NULL OR NOT EXISTS (SELECT 1 FROM jsonb_each(s.opening_hours_json) d WHERE jsonb_typeof(d.value) = 'array' AND jsonb_array_length(d.value) > 0)
              THEN TRUE ELSE coalesce(jsonb_typeof(s.opening_hours_json->'sat') = 'array' AND jsonb_array_length(s.opening_hours_json->'sat') > 0, FALSE) END AS saturday_open,
         e.catchment_cities,
         e.sqm_waiting, coalesce(f.surface_sqm, e.surface_sqm) AS surface_sqm, coalesce(public.ambulatori_room(s.id), e.rooms) AS rooms, coalesce(f.boxes, e.boxes) AS boxes,
         e.parking, e.accessibility, e.services, e.commercial_description,
         e.notes, e.updated_at AS ext_updated_at, s.extraurbana,
         (f.surface_sqm IS NOT NULL OR f.boxes IS NOT NULL) AS struttura_da_facility, (public.ambulatori_room(s.id) IS NOT NULL) AS ambulatori_da_room
    FROM public.sites s LEFT JOIN site_ext e ON e.site_id = s.id
    LEFT JOIN LATERAL public.facility_sede(s.id) f ON TRUE;
INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'retail/013_struttura_da_facility_room.sql', 'Retail: superficie e box da Facility, ambulatori da Room (B4)',
       jsonb_build_object('superfici_box_ripresi_in_facility', public.consolida_superfici_in_facility());
