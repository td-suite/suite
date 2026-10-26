-- Sedi invianti = due origini dell'anagrafica unica (docs/ANAGRAFICA.md): le sedi TD (public.sites, kind <> 'SERVICE') e le
-- Legal entity (public.organizations: laboratori clienti del service, fornitori, partner, società del gruppo), che inviano
-- campioni e ricevono le non conformità preanalitiche come le sedi. I punti dei clienti service (sites kind = 'SERVICE') stanno
-- sotto la loro Legal entity (organization_id) come punti StudioLAB, non sono sedi a sé: una NC che arriva dal canale macchina
-- con il codice cliente di un punto si attribuisce alla Legal entity del punto. Nessuna copia dell'anagrafica e nessun CRUD nel
-- modulo: il modulo conserva solo site_ext (sedi) e org_ext (Legal entity) con gli stessi campi operativi.
-- Stessa convenzione del modulo Ordini (orders/migrations/005_strutture_legal_entity.sql):
--   sede_id > 0  = id della sede (public.sites)
--   sede_id < 0  = opposto dell'id della Legal entity (public.organizations)
-- Le colonne generate site_id e org_id (una sola valorizzata) portano le chiavi esterne reali verso l'anagrafica unica,
-- così le query del modulo continuano a usare un solo intero. I dati esistenti riferiti a sedi TD restano validi senza
-- trasformazione; quelli riferiti a un punto SERVICE passano alla sua Legal entity (nessuna riga persa).

-- Impostazioni NC della Legal entity: stessi campi di site_ext.
CREATE TABLE org_ext (
  org_id         INT PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  codice_lis     TEXT,                                   -- CodiceCliente StudioLAB della Legal entity, se non coincide con i codici dei suoi punti
  canale         TEXT NOT NULL DEFAULT 'EMAIL' CHECK (canale IN ('EMAIL','PEC','PORTALE','NESSUNO')),
  email_nc       TEXT,                                   -- casella che riceve le non conformità (se vuota: email della Legal entity in Amministrazione)
  pec            TEXT,                                   -- PEC, usata quando il canale è PEC (se vuota: PEC della Legal entity in Amministrazione)
  email_cc       TEXT,
  sla_ore        INT CHECK (sla_ore IS NULL OR sla_ore BETWEEN 1 AND 240),
  attiva         BOOLEAN NOT NULL DEFAULT TRUE,
  note           TEXT,
  lis_json       JSONB,
  lis_synced_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX org_ext_codice_lis_uq ON org_ext (lower(codice_lis)) WHERE codice_lis IS NOT NULL;

-- Chiave unificata: via la FK diretta verso public.sites, al suo posto le due colonne generate con le FK reali.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['nc','accettazioni'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_sede_id_fkey');
    EXECUTE format('ALTER TABLE %I
        ADD COLUMN site_id INT GENERATED ALWAYS AS (CASE WHEN sede_id > 0 THEN sede_id END) STORED REFERENCES public.sites(id),
        ADD COLUMN org_id  INT GENERATED ALWAYS AS (CASE WHEN sede_id < 0 THEN -sede_id END) STORED REFERENCES public.organizations(id),
        ADD CONSTRAINT %I CHECK (sede_id IS NULL OR sede_id <> 0)', t, t || '_sede_id_check');
  END LOOP;
END $$;

-- Dati esistenti attribuiti a un punto SERVICE: passano alla Legal entity del punto (il punto non è più una sede a sé).
-- Le impostazioni NC del punto, se la Legal entity non ne ha, diventano le sue (il codice LIS resta sul punto: lo risolve
-- l'anagrafica tramite sites.studiolab_code e site_ext.codice_lis).
INSERT INTO org_ext (org_id, canale, email_nc, pec, email_cc, sla_ore, attiva, note, lis_json, lis_synced_at)
  SELECT DISTINCT ON (s.organization_id) s.organization_id, e.canale, e.email_nc, e.pec, e.email_cc, e.sla_ore, e.attiva, e.note, e.lis_json, e.lis_synced_at
    FROM site_ext e JOIN public.sites s ON s.id = e.site_id
   WHERE s.kind = 'SERVICE' AND s.organization_id IS NOT NULL
   ORDER BY s.organization_id, e.updated_at DESC
  ON CONFLICT (org_id) DO NOTHING;
UPDATE nc n SET sede_id = -s.organization_id FROM public.sites s WHERE s.id = n.sede_id AND s.kind = 'SERVICE' AND s.organization_id IS NOT NULL;
UPDATE accettazioni a SET sede_id = -s.organization_id FROM public.sites s WHERE s.id = a.sede_id AND s.kind = 'SERVICE' AND s.organization_id IS NOT NULL;

-- Vista unica delle sedi invianti con le colonne che il codice del modulo si aspetta (id, codice, nome, tipo, telefono,
-- referente, indirizzo, citta, attiva, configurata, canale, email_effettiva, email_cc, sla_ore...). origin = 'SITE' (sede TD)
-- o 'ORG' (Legal entity). I punti SERVICE restano nella vista (punto_service = TRUE) solo per risolvere eventuali riferimenti
-- residui: l'elenco e i selettori li escludono e li mostrano come punti della Legal entity (colonna punti delle righe ORG).
-- sites_v (migrazione 003) resta ma non è più usata dal codice.
CREATE VIEW sedi_v AS
  SELECT s.id, 'SITE'::text AS origin, s.id AS site_id, NULL::int AS org_id,
         coalesce(e.codice_lis, s.studiolab_code, s.code) AS codice,
         s.code AS suite_code, s.studiolab_code,
         s.name AS nome, s.kind AS tipo, s.kind AS site_kind, NULL::text AS org_kind,
         s.phone AS telefono, s.manager_name AS referente, s.address AS indirizzo,
         nullif(concat_ws(' ', s.zip, s.city, CASE WHEN s.province IS NOT NULL THEN '(' || s.province || ')' END), '') AS citta,
         s.organization_id, o.name AS organization_name, o.vat_number,
         s.active AS attiva_suite,
         (s.active AND coalesce(e.attiva, TRUE)) AS attiva,
         (e.site_id IS NOT NULL) AS configurata,
         coalesce(e.canale, 'EMAIL') AS canale,
         e.codice_lis, e.email_nc, e.pec, e.email_cc, s.email AS email_suite, NULL::text AS pec_suite,
         CASE WHEN coalesce(e.canale, 'EMAIL') IN ('NESSUNO', 'PORTALE') THEN NULL
              WHEN coalesce(e.canale, 'EMAIL') = 'PEC' THEN coalesce(e.pec, e.email_nc, s.email)
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
         e.codice_lis, e.email_nc, e.pec, e.email_cc, o.email AS email_suite, o.pec AS pec_suite,
         CASE WHEN coalesce(e.canale, 'EMAIL') IN ('NESSUNO', 'PORTALE') THEN NULL
              WHEN coalesce(e.canale, 'EMAIL') = 'PEC' THEN coalesce(e.pec, o.pec, e.email_nc, o.email)
              ELSE coalesce(e.email_nc, o.email) END AS email_effettiva,
         e.sla_ore, e.note, e.lis_json, e.lis_synced_at, e.updated_at AS ext_updated_at,
         FALSE AS punto_service,
         coalesce((SELECT json_agg(json_build_object('id', p.id, 'code', p.code, 'name', p.name, 'city', p.city, 'studiolab_code', p.studiolab_code, 'active', p.active) ORDER BY p.sort_order, p.name)
                     FROM public.sites p WHERE p.organization_id = o.id AND p.kind = 'SERVICE'), '[]'::json) AS punti,
         1000 AS sort_order
    FROM public.organizations o
    LEFT JOIN org_ext e ON e.org_id = o.id;
