-- Programma "anagrafica unica", blocco 3 (08/11/2026), B4: superficie, locali e box prelievo hanno un solo proprietario, Facility
-- (facility.properties); Retail li legge da qui. Le ore e i giorni di apertura settimanali si calcolano dagli orari della sede
-- (public.sites.opening_hours_json, funzioni core public.ore_apertura_settimana e giorni_apertura_settimana): i valori scritti a mano
-- restano come riserva per le sedi senza orari. Non distruttiva: colonna nuova e completamento dei soli valori mancanti.
ALTER TABLE properties ADD COLUMN IF NOT EXISTS boxes INT CHECK (boxes IS NULL OR boxes >= 0);
INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'facility/005_anagrafica_blocco3.sql', 'Facility: superficie, locali e box di sede (B4)',
       jsonb_build_object('superfici_box_ripresi_da_retail', public.consolida_superfici_in_facility(),
                          'immobili_con_ore_manuali_e_orari_in_anagrafica', (SELECT count(*) FROM properties p JOIN public.sites s ON s.id = p.site_id WHERE p.opening_hours_week IS NOT NULL AND s.opening_hours_json IS NOT NULL));
