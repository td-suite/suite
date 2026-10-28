-- Responsabile di sede dall'organigramma (segnalazione del CEO, 28/10/2026: "la tabella non riporta il nome del responsabile indicato
-- in amministrazione, idem la sua mail"). La vista leggeva public.sites.manager_name, testo libero che la Suite non compila più: il
-- responsabile è il capo del nodo Sede dell'organigramma (stessa regola di Amministrazione > Sedi), con la sua email dall'anagrafica.
-- manager_name resta come riserva per le sedi senza nodo in organigramma.
DROP VIEW IF EXISTS sites_v;
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.short_name, s.kind, s.address, s.zip, s.city, s.province, s.phone, s.email,
         coalesce(h.person_name, s.manager_name) AS manager_name, h.person_email AS manager_email, h.person_id AS manager_person_id,
         s.active, s.sort_order,
         e.data, e.version, e.created_at, e.updated_at, e.updated_by, (e.site_id IS NOT NULL) AS configurata
    FROM public.sites s LEFT JOIN site_ext e ON e.site_id = s.id
    LEFT JOIN LATERAL (SELECT op.person_id, pp.last_name || ' ' || pp.first_name AS person_name, pp.email AS person_email
                         FROM public.org_units u JOIN public.org_positions op ON op.unit_id = u.id AND op.is_head
                         JOIN public.people pp ON pp.id = op.person_id
                        WHERE u.kind = 'SEDE' AND u.site_id = s.id ORDER BY op.sort_order, op.id LIMIT 1) h ON TRUE;
