-- Sedi non ancora aperte (richiesta del CEO, 30/10/2026: "COR sarà attivo dal 2 gennaio 2027"): la data di apertura dell'anagrafica
-- (public.sites.opened_at) entra nella vista; l'auto-audit mensile, l'alert del 17 e i contatori riguardano solo le sedi in esercizio
-- nel mese (opened_at nulla o entro la fine del mese).
DROP VIEW IF EXISTS sites_v;
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.short_name, s.kind, s.address, s.zip, s.city, s.province, s.phone, s.email, s.organization_id,
         coalesce(h.person_name, s.manager_name) AS manager_name, h.person_email AS manager_email, h.person_id AS manager_person_id,
         s.active, s.sort_order, s.opened_at,
         (s.active AND (s.opened_at IS NULL OR s.opened_at <= (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date)) AS in_esercizio
    FROM public.sites s
    LEFT JOIN LATERAL (SELECT op.person_id, pp.last_name || ' ' || pp.first_name AS person_name, pp.email AS person_email
                         FROM public.org_units u JOIN public.org_positions op ON op.unit_id = u.id AND op.is_head
                         JOIN public.people pp ON pp.id = op.person_id
                        WHERE u.kind = 'SEDE' AND u.site_id = s.id ORDER BY op.sort_order, op.id LIMIT 1) h ON TRUE
   WHERE s.kind <> 'SERVICE';
