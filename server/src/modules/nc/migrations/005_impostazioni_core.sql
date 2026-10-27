-- Impostazioni senza doppia compilazione (richiesta del CEO, 27/10/2026, docs/IMPOSTAZIONI.md). Non conformità non chiede più
-- dati che l'anagrafica unica ha già:
-- * site_ext.codice_lis (codice cliente StudioLAB della sede TD) duplicava public.sites.studiolab_code: i valori esistenti
--   completano il core dove manca, poi la colonna sparisce. org_ext.codice_lis resta: il core non prevede un codice StudioLAB
--   sulle Legal entity (i codici sono dei punti) e serve quando il LIS usa un codice proprio del cliente.
-- * site_ext.pec e org_ext.pec duplicavano public.organizations.pec (per una sede TD la PEC è quella della sua Legal entity):
--   i valori delle Legal entity completano il core dove manca, poi le colonne spariscono.
-- * email_nc resta (casella dedicata alle NC): se vuota si usa l'email della sede o della Legal entity in Amministrazione.
UPDATE public.sites s SET studiolab_code = e.codice_lis, updated_at = now() FROM site_ext e WHERE e.site_id = s.id AND s.studiolab_code IS NULL AND e.codice_lis IS NOT NULL AND e.codice_lis <> '';
UPDATE public.organizations o SET pec = e.pec, updated_at = now() FROM org_ext e WHERE e.org_id = o.id AND o.pec IS NULL AND e.pec IS NOT NULL AND e.pec <> '';
UPDATE public.organizations o SET pec = e.pec, updated_at = now() FROM site_ext e JOIN public.sites s ON s.id = e.site_id WHERE s.organization_id = o.id AND o.pec IS NULL AND e.pec IS NOT NULL AND e.pec <> '';

DROP VIEW IF EXISTS sedi_v;
DROP VIEW IF EXISTS sites_v;
DROP INDEX IF EXISTS site_ext_codice_lis_uq;
ALTER TABLE site_ext DROP COLUMN IF EXISTS codice_lis, DROP COLUMN IF EXISTS pec;
ALTER TABLE org_ext DROP COLUMN IF EXISTS pec;

-- Vista unica delle sedi invianti (stesse colonne della migrazione 004): codice e PEC vengono dal core.
CREATE VIEW sedi_v AS
  SELECT s.id, 'SITE'::text AS origin, s.id AS site_id, NULL::int AS org_id,
         coalesce(s.studiolab_code, s.code) AS codice,
         s.code AS suite_code, s.studiolab_code,
         s.name AS nome, s.kind AS tipo, s.kind AS site_kind, NULL::text AS org_kind,
         s.phone AS telefono, s.manager_name AS referente, s.address AS indirizzo,
         nullif(concat_ws(' ', s.zip, s.city, CASE WHEN s.province IS NOT NULL THEN '(' || s.province || ')' END), '') AS citta,
         s.organization_id, o.name AS organization_name, o.vat_number,
         s.active AS attiva_suite,
         (s.active AND coalesce(e.attiva, TRUE)) AS attiva,
         (e.site_id IS NOT NULL) AS configurata,
         coalesce(e.canale, 'EMAIL') AS canale,
         NULL::text AS codice_lis, e.email_nc, o.pec, e.email_cc, s.email AS email_suite, o.pec AS pec_suite,
         CASE WHEN coalesce(e.canale, 'EMAIL') IN ('NESSUNO', 'PORTALE') THEN NULL
              WHEN coalesce(e.canale, 'EMAIL') = 'PEC' THEN coalesce(o.pec, e.email_nc, s.email)
              ELSE coalesce(e.email_nc, s.email) END AS email_effettiva,
         e.sla_ore, e.note, e.lis_json, e.lis_synced_at, e.updated_at AS ext_updated_at,
         (s.kind = 'SERVICE') AS punto_service,
         '[]'::json AS punti,
         s.sort_order
    FROM public.sites s
    LEFT JOIN site_ext e ON e.site_id = s.id
    LEFT JOIN public.organizations o ON o.id = s.organization_id
  UNION ALL
  SELECT -o.id AS id, 'ORG'::text AS origin, NULL::int AS site_id, o.id AS org_id,
         coalesce(e.codice_lis, o.code, 'LE' || o.id) AS codice,
         coalesce(o.code, 'LE' || o.id) AS suite_code, NULL::text AS studiolab_code,
         o.name AS nome, o.kind AS tipo, NULL::text AS site_kind, o.kind AS org_kind,
         o.phone AS telefono, NULL::text AS referente, o.address AS indirizzo,
         nullif(concat_ws(' ', o.zip, o.city, CASE WHEN o.province IS NOT NULL THEN '(' || o.province || ')' END), '') AS citta,
         o.id AS organization_id, o.name AS organization_name, o.vat_number,
         o.active AS attiva_suite,
         (o.active AND coalesce(e.attiva, TRUE)) AS attiva,
         (e.org_id IS NOT NULL) AS configurata,
         coalesce(e.canale, 'EMAIL') AS canale,
         e.codice_lis, e.email_nc, o.pec, e.email_cc, o.email AS email_suite, o.pec AS pec_suite,
         CASE WHEN coalesce(e.canale, 'EMAIL') IN ('NESSUNO', 'PORTALE') THEN NULL
              WHEN coalesce(e.canale, 'EMAIL') = 'PEC' THEN coalesce(o.pec, e.email_nc, o.email)
              ELSE coalesce(e.email_nc, o.email) END AS email_effettiva,
         e.sla_ore, e.note, e.lis_json, e.lis_synced_at, e.updated_at AS ext_updated_at,
         FALSE AS punto_service,
         coalesce((SELECT json_agg(json_build_object('id', p.id, 'code', p.code, 'name', p.name, 'city', p.city, 'studiolab_code', p.studiolab_code, 'active', p.active) ORDER BY p.sort_order, p.name)
                     FROM public.sites p WHERE p.organization_id = o.id AND p.kind = 'SERVICE'), '[]'::json) AS punti,
         1000 AS sort_order
    FROM public.organizations o
    LEFT JOIN org_ext e ON e.org_id = o.id;
