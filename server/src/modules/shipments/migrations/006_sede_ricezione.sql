-- Programma "anagrafica unica", blocco 3 (08/11/2026), C1: la sede TD che riceve il campione è una sede dell'anagrafica
-- (orders.sample_received_site_id → public.sites), non più un testo scelto da un elenco nelle impostazioni (td_sites, non più letto).
-- Non distruttiva: il testo sample_received_site resta (storico e ripiego); la colonna nuova si completa solo dove il testo corrisponde
-- a una sola sede (nome, nome breve o codice); i testi non riconosciuti escono nel rapporto. L'impostazione td_sites resta nel database.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sample_received_site_id INT REFERENCES public.sites(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_sample_site_idx ON orders (sample_received_site_id) WHERE sample_received_site_id IS NOT NULL;
WITH c AS (
  SELECT o.id, (array_agg(s.id))[1] AS site_id, count(*) AS n FROM orders o JOIN public.sites s
      ON lower(trim(o.sample_received_site)) IN (lower(s.name), lower(coalesce(s.short_name, '')), lower(s.code), lower(coalesce(s.city, '')))
   WHERE o.sample_received_site_id IS NULL AND coalesce(o.sample_received_site, '') <> '' AND s.kind <> 'SERVICE'
   GROUP BY o.id)
UPDATE orders o SET sample_received_site_id = c.site_id FROM c WHERE c.id = o.id AND c.n = 1;
INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'shipments/006_sede_ricezione.sql', 'Spedizioni: sede di ricezione del campione dall''anagrafica (C1)',
       jsonb_build_object(
         'ordini_con_sede_riconosciuta', (SELECT count(*) FROM orders WHERE sample_received_site_id IS NOT NULL),
         'testi_non_riconosciuti', (SELECT coalesce(jsonb_agg(DISTINCT sample_received_site), '[]'::jsonb) FROM orders WHERE sample_received_site_id IS NULL AND coalesce(sample_received_site, '') <> ''),
         'impostazione_td_sites_non_piu_letta', (SELECT value FROM app_settings WHERE key = 'td_sites'));
