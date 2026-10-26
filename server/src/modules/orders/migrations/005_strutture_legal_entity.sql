-- Strutture = due origini dell'anagrafica unica (docs/ANAGRAFICA.md): le sedi TD (public.sites, kind <> 'SERVICE') e le
-- Legal entity (public.organizations: clienti del service di laboratorio, partner, fornitori, società del gruppo), che ordinano
-- e ricevono materiale come le sedi. I punti dei clienti service (sites kind = 'SERVICE') stanno sotto la loro Legal entity
-- (organization_id) come punti di consegna, non sono strutture a sé. Nessuna copia dell'anagrafica e nessun CRUD nel modulo:
-- il modulo conserva solo site_ext (sedi) e org_ext (Legal entity) con gli stessi campi operativi.
--
-- Chiave unica della struttura nel modulo (orders.struttura_id, packages, stock_counts, production, issues, email_log):
--   struttura_id > 0  = id della sede (public.sites)
--   struttura_id < 0  = opposto dell'id della Legal entity (public.organizations)
-- Le colonne generate site_id e org_id (una sola valorizzata) portano le chiavi esterne reali verso l'anagrafica unica:
-- è la coppia "sede o Legal entity, uno dei due" realizzata senza cambiare le query del modulo, che continuano a usare un
-- solo intero. I dati esistenti (tutti riferiti a sedi, quindi positivi) restano validi senza alcuna trasformazione.

-- Impostazioni Ordini della Legal entity: stessi campi di site_ext. Senza riga vale il ruolo CLIENTE (ordina dal catalogo,
-- il materiale consegnato è in carico al cliente) e la giacenza entro il 15.
CREATE TABLE org_ext (
  org_id             INT PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind               TEXT CHECK (kind IN ('CLIENTE','SEDE','LAB')),
  silva_code         TEXT,
  stock_deadline_day INT CHECK (stock_deadline_day BETWEEN 1 AND 31),
  referente          TEXT,
  referente_phone    TEXT,
  delivery_mode      TEXT NOT NULL DEFAULT 'GIRO' CHECK (delivery_mode IN ('GIRO','RITIRO')),
  delivery_notes     TEXT,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX org_ext_silva_code_uq ON org_ext (upper(silva_code)) WHERE silva_code IS NOT NULL AND silva_code <> '';

-- Chiave unificata: via la FK diretta verso public.sites, al suo posto le due colonne generate con le FK reali.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['orders','production','packages','stock_counts','issues'] LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I', t, t || '_struttura_id_fkey');
    EXECUTE format('ALTER TABLE %I
        ADD COLUMN site_id INT GENERATED ALWAYS AS (CASE WHEN struttura_id > 0 THEN struttura_id END) STORED REFERENCES public.sites(id),
        ADD COLUMN org_id  INT GENERATED ALWAYS AS (CASE WHEN struttura_id < 0 THEN -struttura_id END) STORED REFERENCES public.organizations(id),
        ADD CONSTRAINT %I CHECK (struttura_id <> 0)', t, t || '_struttura_id_check');
  END LOOP;
END $$;
-- Registro invii: colonna informativa, puo' riferire una sede o una Legal entity; una colonna generata non ammette ON DELETE SET NULL,
-- quindi resta senza chiave esterna (la riga del registro sopravvive alla cancellazione dell'anagrafica).
ALTER TABLE email_log DROP CONSTRAINT IF EXISTS email_log_struttura_id_fkey;

-- Vista unica delle strutture del modulo con le colonne che il codice si aspetta (id, code, name, kind, address, email,
-- silva_code, stock_deadline_day, configured, active...). origin = 'SITE' (sede) o 'ORG' (Legal entity).
-- Le sedi SERVICE restano nella vista (delivery_point = TRUE) solo per risolvere eventuali riferimenti: l'elenco e i
-- selettori le escludono e le mostrano come punti di consegna della Legal entity (colonna points delle righe ORG).
CREATE VIEW strutture_v AS
  SELECT s.id, 'SITE'::text AS origin, s.id AS site_id, NULL::int AS org_id,
         s.code, s.name, s.short_name, s.kind AS site_kind, NULL::text AS org_kind, k.kind,
         s.address, s.zip, s.city, s.province, s.phone, s.email, o.pec, o.vat_number,
         s.organization_id, o.name AS organization_name,
         s.studiolab_code, e.silva_code,
         coalesce(e.stock_deadline_day, CASE WHEN k.kind = 'LAB' THEN 30 ELSE 15 END) AS stock_deadline_day,
         e.referente, e.referente_phone, coalesce(e.delivery_mode, 'GIRO') AS delivery_mode, e.delivery_notes, e.notes,
         (e.site_id IS NOT NULL) AS configured,
         (s.kind = 'SERVICE') AS delivery_point,
         '[]'::json AS points,
         s.active, s.sort_order, s.created_at, coalesce(e.updated_at, s.updated_at) AS updated_at
    FROM public.sites s
    LEFT JOIN site_ext e ON e.site_id = s.id
    LEFT JOIN public.organizations o ON o.id = s.organization_id
    CROSS JOIN LATERAL (SELECT coalesce(e.kind, CASE s.kind WHEN 'SERVICE' THEN 'CLIENTE' WHEN 'LABORATORIO' THEN 'LAB' ELSE 'SEDE' END) AS kind) k
  UNION ALL
  SELECT -o.id AS id, 'ORG'::text AS origin, NULL::int AS site_id, o.id AS org_id,
         coalesce(o.code, 'LE' || o.id) AS code, o.name, NULL::text AS short_name, NULL::text AS site_kind, o.kind AS org_kind, coalesce(e.kind, 'CLIENTE') AS kind,
         o.address, o.zip, o.city, o.province, o.phone, o.email, o.pec, o.vat_number,
         o.id AS organization_id, o.name AS organization_name,
         NULL::text AS studiolab_code, e.silva_code,
         coalesce(e.stock_deadline_day, CASE WHEN e.kind = 'LAB' THEN 30 ELSE 15 END) AS stock_deadline_day,
         e.referente, e.referente_phone, coalesce(e.delivery_mode, 'GIRO') AS delivery_mode, e.delivery_notes, e.notes,
         (e.org_id IS NOT NULL) AS configured,
         FALSE AS delivery_point,
         coalesce((SELECT json_agg(json_build_object('id', p.id, 'code', p.code, 'name', p.name, 'city', p.city, 'studiolab_code', p.studiolab_code, 'active', p.active) ORDER BY p.sort_order, p.name)
                     FROM public.sites p WHERE p.organization_id = o.id AND p.kind = 'SERVICE'), '[]'::json) AS points,
         o.active, 1000 AS sort_order, o.created_at, coalesce(e.updated_at, o.updated_at) AS updated_at
    FROM public.organizations o
    LEFT JOIN org_ext e ON e.org_id = o.id;
