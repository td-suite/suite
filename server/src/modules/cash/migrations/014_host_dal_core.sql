-- Legal entity ospitante dall'anagrafica unica (public.sites.host_organization_id, richiesta del CEO del 29/10/2026): è la stessa
-- Legal entity con cui il partner accede alla Suite. Cash la legge dal core (con site_ext.host_org_id come riserva per le sedi non
-- ancora riallineate) e, quando l'amministratore la imposta da Cash, la scrive anche nel core (routes/admin.js).
UPDATE public.sites s SET host_organization_id = e.host_org_id FROM site_ext e WHERE e.site_id = s.id AND e.host_org_id IS NOT NULL AND s.host_organization_id IS NULL;
DROP VIEW IF EXISTS sites_v;
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.address, s.city, s.province, s.active, s.kind, s.organization_id,
         (e.site_id IS NOT NULL) AS configured,
         e.company_id, e.cash_float,
         core_operating_days(s.opening_hours_json) AS operating_days,
         (s.opening_hours_json IS NOT NULL AND core_operating_days(s.opening_hours_json) <> '0000000' AND core_hours(s.opening_hours_json) <> '{}'::jsonb) AS hours_from_core,
         e.pos_terminals,
         coalesce(s.opened_at, e.created_at::date) AS start_date, s.opened_at,
         CASE WHEN coalesce(s.host_organization_id, e.host_org_id) IS NOT NULL THEN 'OSPITATA' ELSE coalesce(e.ownership, 'PROPRIA') END AS ownership,
         core_hours(s.opening_hours_json) AS hours, s.opening_hours AS hours_note,
         e.expected_registers, s.email AS site_email,
         coalesce(s.host_organization_id, e.host_org_id) AS host_org_id, ho.name AS host_name, ho.vat_number AS host_vat, ho.email AS host_email,
         e.royalty_fixed_monthly, e.royalty_pct, e.royalty_base, e.royalty_vat_rate, e.royalty_notes,
         e.created_at, e.updated_at
    FROM public.sites s
    LEFT JOIN site_ext e ON e.site_id = s.id
    LEFT JOIN public.organizations ho ON ho.id = coalesce(s.host_organization_id, e.host_org_id)
   WHERE s.kind IS DISTINCT FROM 'SERVICE';
