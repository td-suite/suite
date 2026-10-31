-- Titolo di godimento dall'anagrafica unica (public.sites.tenure, Amministrazione > Sedi, 31/10/2026): per Cash una sede è OSPITATA
-- (struttura ospitante con royalties) solo se il titolo è Ospitata; proprietà, locazione e comodato sono sedi proprie (PROPRIA).
UPDATE site_ext e SET ownership = CASE WHEN s.tenure = 'OSPITATA' THEN 'OSPITATA' ELSE 'PROPRIA' END, host_org_id = CASE WHEN s.tenure = 'OSPITATA' THEN coalesce(s.host_organization_id, e.host_org_id) ELSE NULL END
  FROM public.sites s WHERE s.id = e.site_id AND s.tenure IS NOT NULL;
DROP VIEW IF EXISTS sites_v;
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.address, s.city, s.province, s.active, s.kind, s.organization_id,
         (e.site_id IS NOT NULL) AS configured,
         e.company_id, e.cash_float,
         core_operating_days(s.opening_hours_json) AS operating_days,
         (s.opening_hours_json IS NOT NULL AND core_operating_days(s.opening_hours_json) <> '0000000' AND core_hours(s.opening_hours_json) <> '{}'::jsonb) AS hours_from_core,
         e.pos_terminals,
         coalesce(s.opened_at, e.created_at::date) AS start_date, s.opened_at,
         CASE WHEN s.tenure = 'OSPITATA' THEN 'OSPITATA' WHEN s.tenure IS NOT NULL THEN 'PROPRIA' WHEN coalesce(s.host_organization_id, e.host_org_id) IS NOT NULL THEN 'OSPITATA' ELSE coalesce(e.ownership, 'PROPRIA') END AS ownership,
         s.tenure,
         core_hours(s.opening_hours_json) AS hours, s.opening_hours AS hours_note,
         e.expected_registers, s.email AS site_email,
         CASE WHEN s.tenure IS NULL OR s.tenure = 'OSPITATA' THEN coalesce(s.host_organization_id, e.host_org_id) END AS host_org_id,
         ho.name AS host_name, ho.vat_number AS host_vat, ho.email AS host_email,
         e.royalty_fixed_monthly, e.royalty_pct, e.royalty_base, e.royalty_vat_rate, e.royalty_notes,
         e.created_at, e.updated_at
    FROM public.sites s
    LEFT JOIN site_ext e ON e.site_id = s.id
    LEFT JOIN public.organizations ho ON ho.id = CASE WHEN s.tenure IS NULL OR s.tenure = 'OSPITATA' THEN coalesce(s.host_organization_id, e.host_org_id) END
   WHERE s.kind IS DISTINCT FROM 'SERVICE';
