-- A4 (programma "anagrafica unica", blocco 2, 08/11/2026): le righe Legal entity (origin ORG) della vista strutture_v sono solo i
-- clienti del servizio, con la regola unica della Suite public.cliente_livello (migrazione core 044): clienti ATTIVI e CONTRATTUALIZZATI
-- di public.clienti_attivi_v (Service e Medicina del Lavoro; i contrattualizzati entrano perché il servizio parte alla firma) oppure
-- Legal entity con punti SERVICE attivi. Prima comparivano tutte le Legal entity (fornitori, partner, prospect, società del gruppo).
-- Non distruttiva: le Legal entity che non sono clienti ma hanno dati nel modulo (ordini, giacenze, confezioni, produzione,
-- segnalazioni, dotazione di avvio) o impostazioni Ordini (org_ext) restano nella vista DISATTIVATE (active = FALSE), così lo storico
-- resta leggibile e non compaiono più nei selettori, nell'elenco Strutture e nella Dotazione di avvio. Nessun dato toccato.
-- Nuova colonna cliente_livello (ATTIVO, CONTRATTUALIZZATO, PUNTO_SERVICE o NULL; NULL per le sedi TD).
-- Il responsabile di sede resta quello attivo (filtro della migrazione 012).
CREATE INDEX IF NOT EXISTS issues_struttura_idx ON issues (struttura_id);
CREATE OR REPLACE VIEW strutture_v AS
SELECT s.id,
    'SITE'::text AS origin,
    s.id AS site_id,
    NULL::integer AS org_id,
    s.code,
    s.name,
    s.short_name,
    s.kind AS site_kind,
    NULL::text AS org_kind,
    k.kind,
    s.address,
    s.zip,
    s.city,
    s.province,
    s.phone,
    s.email,
    o.pec,
    o.vat_number,
    s.organization_id,
    o.name AS organization_name,
    s.studiolab_code,
    e.silva_code,
    COALESCE(e.stock_deadline_day,
        CASE
            WHEN k.kind = 'LAB'::text THEN 30
            ELSE 15
        END) AS stock_deadline_day,
    h.person_name AS referente,
    COALESCE(h.phone, s.phone) AS referente_phone,
    h.person_id AS referente_person_id,
    h.role_name AS referente_role,
    COALESCE(e.delivery_mode, 'GIRO'::text) AS delivery_mode,
    e.delivery_notes,
    e.notes,
    e.site_id IS NOT NULL AS configured,
    s.kind = 'SERVICE'::text AS delivery_point,
    '[]'::json AS points,
    s.active,
    s.sort_order,
    s.created_at,
    COALESCE(e.updated_at, s.updated_at) AS updated_at,
    NULL::text AS cliente_livello
   FROM sites s
     LEFT JOIN orders.site_ext e ON e.site_id = s.id
     LEFT JOIN organizations o ON o.id = s.organization_id
     LEFT JOIN LATERAL ( SELECT op.person_id,
            (pp.last_name || ' '::text) || pp.first_name AS person_name,
            COALESCE(NULLIF(pp.phone, ''::text), NULLIF(pp.phone_office, ''::text)) AS phone,
            jr.name AS role_name
           FROM org_units u
             JOIN org_positions op ON op.unit_id = u.id AND op.is_head
             JOIN people pp ON pp.id = op.person_id AND pp.status = 'ATTIVO'::text
             LEFT JOIN job_roles jr ON jr.id = op.role_id
          WHERE u.kind = 'SEDE'::text AND u.site_id = s.id
          ORDER BY op.sort_order, op.id
         LIMIT 1) h ON true
     CROSS JOIN LATERAL ( SELECT COALESCE(e.kind,
                CASE s.kind
                    WHEN 'SERVICE'::text THEN 'CLIENTE'::text
                    WHEN 'LABORATORIO'::text THEN 'LAB'::text
                    ELSE 'SEDE'::text
                END) AS kind) k
UNION ALL
SELECT - o.id AS id,
    'ORG'::text AS origin,
    NULL::integer AS site_id,
    o.id AS org_id,
    COALESCE(o.code, 'LE'::text || o.id) AS code,
    o.name,
    NULL::text AS short_name,
    NULL::text AS site_kind,
    o.kind AS org_kind,
    COALESCE(e.kind, 'CLIENTE'::text) AS kind,
    o.address,
    o.zip,
    o.city,
    o.province,
    o.phone,
    o.email,
    o.pec,
    o.vat_number,
    o.id AS organization_id,
    o.name AS organization_name,
    NULL::text AS studiolab_code,
    e.silva_code,
    COALESCE(e.stock_deadline_day,
        CASE
            WHEN e.kind = 'LAB'::text THEN 30
            ELSE 15
        END) AS stock_deadline_day,
    NULL::text AS referente,
    o.phone AS referente_phone,
    NULL::integer AS referente_person_id,
    NULL::text AS referente_role,
    COALESCE(e.delivery_mode, 'GIRO'::text) AS delivery_mode,
    e.delivery_notes,
    e.notes,
    e.org_id IS NOT NULL AS configured,
    false AS delivery_point,
    COALESCE(( SELECT json_agg(json_build_object('id', p.id, 'code', p.code, 'name', p.name, 'city', p.city, 'studiolab_code', p.studiolab_code, 'active', p.active) ORDER BY p.sort_order, p.name) AS json_agg
           FROM sites p
          WHERE p.organization_id = o.id AND p.kind = 'SERVICE'::text), '[]'::json) AS points,
    o.active AND cl.livello IS NOT NULL AS active,
    1000 AS sort_order,
    o.created_at,
    COALESCE(e.updated_at, o.updated_at) AS updated_at,
    cl.livello AS cliente_livello
   FROM organizations o
     LEFT JOIN orders.org_ext e ON e.org_id = o.id
     CROSS JOIN LATERAL ( SELECT public.cliente_livello(o.id) AS livello) cl
  WHERE cl.livello IS NOT NULL OR e.org_id IS NOT NULL
     OR EXISTS ( SELECT 1 FROM orders.orders x WHERE x.struttura_id = - o.id)
     OR EXISTS ( SELECT 1 FROM orders.stock_counts x WHERE x.struttura_id = - o.id)
     OR EXISTS ( SELECT 1 FROM orders.packages x WHERE x.struttura_id = - o.id)
     OR EXISTS ( SELECT 1 FROM orders.production x WHERE x.struttura_id = - o.id)
     OR EXISTS ( SELECT 1 FROM orders.issues x WHERE x.struttura_id = - o.id)
     OR EXISTS ( SELECT 1 FROM orders.startup_loads x WHERE x.struttura_id = - o.id);
