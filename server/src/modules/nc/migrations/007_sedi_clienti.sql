-- A4 (programma "anagrafica unica", blocco 2, 08/11/2026): le righe Legal entity (origin ORG) della vista sedi_v sono solo i clienti
-- del servizio, con la regola unica della Suite public.cliente_livello (migrazione core 044): clienti ATTIVI e CONTRATTUALIZZATI di
-- public.clienti_attivi_v (Service e Medicina del Lavoro; i contrattualizzati entrano perché il servizio parte alla firma) oppure Legal
-- entity con punti SERVICE attivi. Prima comparivano tutte le Legal entity.
-- Non distruttiva: le Legal entity non clienti con dati nel modulo (NC, accettazioni) o impostazioni NC (org_ext) restano nella vista
-- non attive (attiva = FALSE, attiva_suite invariata): lo storico e l'abbinamento dei codici restano, non compaiono più tra le sedi
-- invianti attive. Nuova colonna cliente_livello (NULL per le sedi TD). Nessun dato toccato.
CREATE OR REPLACE VIEW sedi_v AS
SELECT s.id,
    'SITE'::text AS origin,
    s.id AS site_id,
    NULL::integer AS org_id,
    COALESCE(s.studiolab_code, s.code) AS codice,
    s.code AS suite_code,
    s.studiolab_code,
    s.name AS nome,
    s.kind AS tipo,
    s.kind AS site_kind,
    NULL::text AS org_kind,
    s.phone AS telefono,
    s.manager_name AS referente,
    s.address AS indirizzo,
    NULLIF(concat_ws(' '::text, s.zip, s.city,
        CASE
            WHEN s.province IS NOT NULL THEN ('('::text || s.province) || ')'::text
            ELSE NULL::text
        END), ''::text) AS citta,
    s.organization_id,
    o.name AS organization_name,
    o.vat_number,
    s.active AS attiva_suite,
    s.active AND COALESCE(e.attiva, true) AS attiva,
    e.site_id IS NOT NULL AS configurata,
    COALESCE(e.canale, 'EMAIL'::text) AS canale,
    NULL::text AS codice_lis,
    e.email_nc,
    o.pec,
    e.email_cc,
    s.email AS email_suite,
    o.pec AS pec_suite,
        CASE
            WHEN COALESCE(e.canale, 'EMAIL'::text) = ANY (ARRAY['NESSUNO'::text, 'PORTALE'::text]) THEN NULL::text
            WHEN COALESCE(e.canale, 'EMAIL'::text) = 'PEC'::text THEN COALESCE(o.pec, e.email_nc, s.email)
            ELSE COALESCE(e.email_nc, s.email)
        END AS email_effettiva,
    e.sla_ore,
    e.note,
    e.lis_json,
    e.lis_synced_at,
    e.updated_at AS ext_updated_at,
    s.kind = 'SERVICE'::text AS punto_service,
    '[]'::json AS punti,
    s.sort_order,
    NULL::text AS cliente_livello
   FROM sites s
     LEFT JOIN nc.site_ext e ON e.site_id = s.id
     LEFT JOIN organizations o ON o.id = s.organization_id
UNION ALL
SELECT - o.id AS id,
    'ORG'::text AS origin,
    NULL::integer AS site_id,
    o.id AS org_id,
    COALESCE(e.codice_lis, o.code, 'LE'::text || o.id) AS codice,
    COALESCE(o.code, 'LE'::text || o.id) AS suite_code,
    NULL::text AS studiolab_code,
    o.name AS nome,
    o.kind AS tipo,
    NULL::text AS site_kind,
    o.kind AS org_kind,
    o.phone AS telefono,
    NULL::text AS referente,
    o.address AS indirizzo,
    NULLIF(concat_ws(' '::text, o.zip, o.city,
        CASE
            WHEN o.province IS NOT NULL THEN ('('::text || o.province) || ')'::text
            ELSE NULL::text
        END), ''::text) AS citta,
    o.id AS organization_id,
    o.name AS organization_name,
    o.vat_number,
    o.active AS attiva_suite,
    o.active AND COALESCE(e.attiva, true) AND cl.livello IS NOT NULL AS attiva,
    e.org_id IS NOT NULL AS configurata,
    COALESCE(e.canale, 'EMAIL'::text) AS canale,
    e.codice_lis,
    e.email_nc,
    o.pec,
    e.email_cc,
    o.email AS email_suite,
    o.pec AS pec_suite,
        CASE
            WHEN COALESCE(e.canale, 'EMAIL'::text) = ANY (ARRAY['NESSUNO'::text, 'PORTALE'::text]) THEN NULL::text
            WHEN COALESCE(e.canale, 'EMAIL'::text) = 'PEC'::text THEN COALESCE(o.pec, e.email_nc, o.email)
            ELSE COALESCE(e.email_nc, o.email)
        END AS email_effettiva,
    e.sla_ore,
    e.note,
    e.lis_json,
    e.lis_synced_at,
    e.updated_at AS ext_updated_at,
    false AS punto_service,
    COALESCE(( SELECT json_agg(json_build_object('id', p.id, 'code', p.code, 'name', p.name, 'city', p.city, 'studiolab_code', p.studiolab_code, 'active', p.active) ORDER BY p.sort_order, p.name) AS json_agg
           FROM sites p
          WHERE p.organization_id = o.id AND p.kind = 'SERVICE'::text), '[]'::json) AS punti,
    1000 AS sort_order,
    cl.livello AS cliente_livello
   FROM organizations o
     LEFT JOIN nc.org_ext e ON e.org_id = o.id
     CROSS JOIN LATERAL ( SELECT public.cliente_livello(o.id) AS livello) cl
  WHERE cl.livello IS NOT NULL OR e.org_id IS NOT NULL
     OR EXISTS ( SELECT 1 FROM nc.nc x WHERE x.sede_id = - o.id)
     OR EXISTS ( SELECT 1 FROM nc.accettazioni x WHERE x.sede_id = - o.id);
