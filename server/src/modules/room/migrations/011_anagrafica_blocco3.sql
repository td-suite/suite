-- Programma "anagrafica unica", blocco 3 (08/11/2026). Non distruttiva: solo la vista ridefinita, nessun dato toccato (le impostazioni
-- Room dei punti SERVICE, se c'erano, restano in site_ext e la Diagnostica le elenca con D29).
--   B10: la vista delle sedi di Room non contiene i punti SERVICE dei clienti (Room riguarda le sedi TD);
--   B3:  espone gli orari di apertura della sede (opening_hours_json) letti dal motore al posto della copia in site_ext.data.hours;
--   B2/A8: responsabile del nodo Sede solo tra le persone ATTIVE (come prima), senza il ripiego sul testo sites.manager_name.
DROP VIEW IF EXISTS sites_v;
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.short_name, s.kind, s.address, s.zip, s.city, s.province, s.phone, s.email,
         h.person_name AS manager_name, h.person_email AS manager_email, h.person_id AS manager_person_id,
         s.active, s.sort_order,
         e.data, e.version, e.created_at, e.updated_at, e.updated_by, (e.site_id IS NOT NULL) AS configurata,
         s.opening_hours_json
    FROM public.sites s LEFT JOIN site_ext e ON e.site_id = s.id
    LEFT JOIN LATERAL (SELECT op.person_id, pp.last_name || ' ' || pp.first_name AS person_name, pp.email AS person_email
                         FROM public.org_units u JOIN public.org_positions op ON op.unit_id = u.id AND op.is_head
                         JOIN public.people pp ON pp.id = op.person_id AND pp.status = 'ATTIVO'
                        WHERE u.kind = 'SEDE' AND u.site_id = s.id ORDER BY op.sort_order, op.id LIMIT 1) h ON TRUE
   WHERE s.kind <> 'SERVICE';
INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'room/011_anagrafica_blocco3.sql', 'Room: sedi senza punti SERVICE, orari dall''anagrafica',
       jsonb_build_object(
         'punti_service_configurati_esclusi', (SELECT count(*) FROM site_ext e JOIN public.sites s ON s.id = e.site_id WHERE s.kind = 'SERVICE'),
         'sedi_con_orari_room_e_orari_anagrafica', (SELECT count(*) FROM site_ext e JOIN public.sites s ON s.id = e.site_id WHERE s.opening_hours_json IS NOT NULL AND e.data ? 'hours'),
         'sedi_con_orari_solo_in_room', (SELECT count(*) FROM site_ext e JOIN public.sites s ON s.id = e.site_id WHERE s.opening_hours_json IS NULL AND e.data ? 'hours'));
