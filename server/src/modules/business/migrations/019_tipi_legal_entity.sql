-- Programma "anagrafica unica", blocco 3 (08/11/2026), B5 (decisione 8 del CEO): riclassificazione dei tipi delle Legal entity anche
-- quando il Business Hub parte dopo il core (stessa funzione della migrazione core 045: locatori PARTNER → FORNITORE, partner dei punti
-- prelievo CLIENTE → PARTNER, chi è anche cliente Service/MdL resta CLIENTE con la nota). Idempotente, rapporto in audit_log.
INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'business/019_tipi_legal_entity.sql', 'Business Hub: tipi delle Legal entity (decisione 8)', public.riclassifica_tipi_legal_entity();
