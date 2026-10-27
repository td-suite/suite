-- Impostazioni senza doppia compilazione (richiesta del CEO, 27/10/2026, docs/IMPOSTAZIONI.md). Ordini non chiede più il
-- referente e il suo telefono: per una sede TD il referente è il responsabile di sede dell'organigramma (responsabile del nodo
-- Sede in public.org_units / org_positions) con il telefono della persona (cellulare, poi ufficio) o della sede; per una Legal
-- entity sono il telefono e l'email della Legal entity in Amministrazione. La vista strutture_v conserva le colonne referente e
-- referente_phone calcolate dal core, così PDF dell'ordine, Silva e pagine non cambiano. Le colonne di site_ext / org_ext spariscono.
DROP VIEW IF EXISTS strutture_v;
DROP VIEW IF EXISTS sites_v;   -- vista della migrazione 004, non più usata dal codice
ALTER TABLE site_ext DROP COLUMN IF EXISTS referente, DROP COLUMN IF EXISTS referente_phone;
ALTER TABLE org_ext DROP COLUMN IF EXISTS referente, DROP COLUMN IF EXISTS referente_phone;

CREATE VIEW strutture_v AS
  SELECT s.id, 'SITE'::text AS origin, s.id AS site_id, NULL::int AS org_id,
         s.code, s.name, s.short_name, s.kind AS site_kind, NULL::text AS org_kind, k.kind,
         s.address, s.zip, s.city, s.province, s.phone, s.email, o.pec, o.vat_number,
         s.organization_id, o.name AS organization_name,
         s.studiolab_code, e.silva_code,
         coalesce(e.stock_deadline_day, CASE WHEN k.kind = 'LAB' THEN 30 ELSE 15 END) AS stock_deadline_day,
         h.person_name AS referente, coalesce(h.phone, s.phone) AS referente_phone, h.person_id AS referente_person_id, h.role_name AS referente_role,
         coalesce(e.delivery_mode, 'GIRO') AS delivery_mode, e.delivery_notes, e.notes,
         (e.site_id IS NOT NULL) AS configured,
         (s.kind = 'SERVICE') AS delivery_point,
         '[]'::json AS points,
         s.active, s.sort_order, s.created_at, coalesce(e.updated_at, s.updated_at) AS updated_at
    FROM public.sites s
    LEFT JOIN site_ext e ON e.site_id = s.id
    LEFT JOIN public.organizations o ON o.id = s.organization_id
    LEFT JOIN LATERAL (SELECT op.person_id, pp.last_name || ' ' || pp.first_name AS person_name, coalesce(nullif(pp.phone, ''), nullif(pp.phone_office, '')) AS phone, jr.name AS role_name
                         FROM public.org_units u JOIN public.org_positions op ON op.unit_id = u.id AND op.is_head
                         JOIN public.people pp ON pp.id = op.person_id LEFT JOIN public.job_roles jr ON jr.id = op.role_id
                        WHERE u.kind = 'SEDE' AND u.site_id = s.id ORDER BY op.sort_order, op.id LIMIT 1) h ON TRUE
    CROSS JOIN LATERAL (SELECT coalesce(e.kind, CASE s.kind WHEN 'SERVICE' THEN 'CLIENTE' WHEN 'LABORATORIO' THEN 'LAB' ELSE 'SEDE' END) AS kind) k
  UNION ALL
  SELECT -o.id AS id, 'ORG'::text AS origin, NULL::int AS site_id, o.id AS org_id,
         coalesce(o.code, 'LE' || o.id) AS code, o.name, NULL::text AS short_name, NULL::text AS site_kind, o.kind AS org_kind, coalesce(e.kind, 'CLIENTE') AS kind,
         o.address, o.zip, o.city, o.province, o.phone, o.email, o.pec, o.vat_number,
         o.id AS organization_id, o.name AS organization_name,
         NULL::text AS studiolab_code, e.silva_code,
         coalesce(e.stock_deadline_day, CASE WHEN e.kind = 'LAB' THEN 30 ELSE 15 END) AS stock_deadline_day,
         NULL::text AS referente, o.phone AS referente_phone, NULL::int AS referente_person_id, NULL::text AS referente_role,
         coalesce(e.delivery_mode, 'GIRO') AS delivery_mode, e.delivery_notes, e.notes,
         (e.org_id IS NOT NULL) AS configured,
         FALSE AS delivery_point,
         coalesce((SELECT json_agg(json_build_object('id', p.id, 'code', p.code, 'name', p.name, 'city', p.city, 'studiolab_code', p.studiolab_code, 'active', p.active) ORDER BY p.sort_order, p.name)
                     FROM public.sites p WHERE p.organization_id = o.id AND p.kind = 'SERVICE'), '[]'::json) AS points,
         o.active, 1000 AS sort_order, o.created_at, coalesce(e.updated_at, o.updated_at) AS updated_at
    FROM public.organizations o
    LEFT JOIN org_ext e ON e.org_id = o.id;
