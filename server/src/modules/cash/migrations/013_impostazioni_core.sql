-- Impostazioni senza doppia compilazione (richiesta del CEO, 27/10/2026, docs/IMPOSTAZIONI.md). Cash non chiede più dati che
-- l'anagrafica unica ha già:
-- * hours, hours_note, operating_days (orari e giorni operativi) derivano da public.sites.opening_hours_json;
-- * site_email è public.sites.email;
-- * start_date (data di apertura della sede) è public.sites.opened_at (migrazione core 026): i valori esistenti vengono riportati
--   nel core quando lì manca;
-- * host_name, host_vat, host_email (il partner che ospita il punto prelievi) diventano host_org_id -> public.organizations:
--   il partner è una Legal entity; i valori esistenti vengono agganciati per partita IVA o per nome;
-- * org_ext.iban / bic (coordinate SEPA della società) sono public.organizations.iban / bic (riportati nel core se mancano).
-- La vista sites_v conserva gli stessi nomi di colonna (site_email, operating_days, hours, start_date, host_name, host_vat,
-- host_email) calcolati dal core, così rendiconti, solleciti, statistiche e royalty non cambiano.

-- ---------- 1. Data di apertura e coordinate bancarie nel core ----------
UPDATE public.sites s SET opened_at = e.start_date, updated_at = now() FROM site_ext e WHERE e.site_id = s.id AND s.opened_at IS NULL AND e.start_date IS NOT NULL;
UPDATE public.organizations o SET iban = x.iban, updated_at = now() FROM org_ext x WHERE x.org_id = o.id AND o.iban IS NULL AND x.iban IS NOT NULL AND x.iban <> '';
UPDATE public.organizations o SET bic = x.bic, updated_at = now() FROM org_ext x WHERE x.org_id = o.id AND o.bic IS NULL AND x.bic IS NOT NULL AND x.bic <> '';

-- ---------- 2. Struttura ospitante = Legal entity ----------
ALTER TABLE site_ext ADD COLUMN IF NOT EXISTS host_org_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;
-- aggancio per partita IVA, poi per nome
UPDATE site_ext e SET host_org_id = o.id FROM public.organizations o
 WHERE e.host_org_id IS NULL AND e.host_vat IS NOT NULL AND e.host_vat <> ''
   AND regexp_replace(coalesce(o.vat_number, ''), '\s', '', 'g') = regexp_replace(e.host_vat, '\s', '', 'g');
UPDATE site_ext e SET host_org_id = o.id FROM public.organizations o
 WHERE e.host_org_id IS NULL AND e.host_name IS NOT NULL AND e.host_name <> '' AND lower(unaccent(o.name)) = lower(unaccent(e.host_name));
-- partner non ancora in anagrafica: nasce come Legal entity PARTNER (nessun dato va perso)
INSERT INTO public.organizations (kind, name, vat_number, email, needs_review)
  SELECT 'PARTNER', e.host_name, nullif(e.host_vat, ''), nullif(e.host_email, ''), TRUE
    FROM site_ext e WHERE e.host_org_id IS NULL AND e.host_name IS NOT NULL AND e.host_name <> '';
UPDATE site_ext e SET host_org_id = o.id FROM public.organizations o
 WHERE e.host_org_id IS NULL AND e.host_name IS NOT NULL AND e.host_name <> '' AND lower(unaccent(o.name)) = lower(unaccent(e.host_name));
-- email del partner: se la Legal entity non ce l'ha, prende quella di Cash
UPDATE public.organizations o SET email = e.host_email, updated_at = now() FROM site_ext e WHERE e.host_org_id = o.id AND o.email IS NULL AND e.host_email IS NOT NULL AND e.host_email <> '';
CREATE INDEX IF NOT EXISTS site_ext_host_org_idx ON site_ext (host_org_id);

-- ---------- 3. Funzioni di derivazione dagli orari strutturati del core ----------
-- public.sites.opening_hours_json = {"mon":[{"from":"07:30","to":"12:30"},...], ...}. Cash usa: giorni operativi (stringa di 7
-- cifre lun..dom) e orari per giorno {"1":{"open","close"}} con apertura = prima fascia, chiusura = ultima fascia.
-- Senza orari in anagrafica si assume lunedì-sabato (il valore predefinito storico di Cash).
CREATE OR REPLACE FUNCTION core_operating_days(j jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN j IS NULL OR NOT EXISTS (SELECT 1 FROM (VALUES ('mon'),('tue'),('wed'),('thu'),('fri'),('sat'),('sun')) d(k) WHERE jsonb_typeof(j->d.k) = 'array' AND jsonb_array_length(j->d.k) > 0)
              THEN '1111110'
              ELSE (SELECT string_agg(CASE WHEN jsonb_typeof(j->d.k) = 'array' AND jsonb_array_length(j->d.k) > 0 THEN '1' ELSE '0' END, '' ORDER BY d.n)
                      FROM (VALUES ('mon',1),('tue',2),('wed',3),('thu',4),('fri',5),('sat',6),('sun',7)) d(k, n)) END
$$;
CREATE OR REPLACE FUNCTION core_hours(j jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_object_agg(d.n::text, jsonb_build_object('open', (SELECT min(r->>'from') FROM jsonb_array_elements(j->d.k) r), 'close', (SELECT max(r->>'to') FROM jsonb_array_elements(j->d.k) r))), '{}'::jsonb)
    FROM (VALUES ('mon',1),('tue',2),('wed',3),('thu',4),('fri',5),('sat',6),('sun',7)) d(k, n)
   WHERE j IS NOT NULL AND jsonb_typeof(j->d.k) = 'array' AND jsonb_array_length(j->d.k) > 0
$$;

-- ---------- 4. Via le copie ----------
DROP VIEW IF EXISTS sites_v;
ALTER TABLE site_ext
  DROP COLUMN IF EXISTS hours, DROP COLUMN IF EXISTS hours_note, DROP COLUMN IF EXISTS operating_days, DROP COLUMN IF EXISTS site_email,
  DROP COLUMN IF EXISTS start_date, DROP COLUMN IF EXISTS host_name, DROP COLUMN IF EXISTS host_vat, DROP COLUMN IF EXISTS host_email;
DROP VIEW IF EXISTS operators_v;
DROP VIEW IF EXISTS users_v;
DROP VIEW IF EXISTS companies_v;
ALTER TABLE org_ext DROP COLUMN IF EXISTS iban, DROP COLUMN IF EXISTS bic;

-- ---------- 5. Viste con gli stessi nomi di colonna, calcolati dal core ----------
-- start_date: data di apertura dell'anagrafica; se manca, il giorno in cui la sede è stata configurata in Cash.
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.address, s.city, s.province, s.active, s.kind, s.organization_id,
         (e.site_id IS NOT NULL) AS configured,
         e.company_id, e.cash_float,
         core_operating_days(s.opening_hours_json) AS operating_days,
         (s.opening_hours_json IS NOT NULL AND core_operating_days(s.opening_hours_json) <> '0000000' AND core_hours(s.opening_hours_json) <> '{}'::jsonb) AS hours_from_core,
         e.pos_terminals,
         coalesce(s.opened_at, e.created_at::date) AS start_date, s.opened_at,
         e.ownership,
         core_hours(s.opening_hours_json) AS hours, s.opening_hours AS hours_note,
         e.expected_registers, s.email AS site_email,
         e.host_org_id, ho.name AS host_name, ho.vat_number AS host_vat, ho.email AS host_email,
         e.royalty_fixed_monthly, e.royalty_pct, e.royalty_base, e.royalty_vat_rate, e.royalty_notes,
         e.created_at, e.updated_at
    FROM public.sites s
    LEFT JOIN site_ext e ON e.site_id = s.id
    LEFT JOIN public.organizations ho ON ho.id = e.host_org_id
   WHERE s.kind IS DISTINCT FROM 'SERVICE';

CREATE VIEW companies_v AS
  SELECT o.id, coalesce(o.code, 'ORG' || o.id) AS code, o.name, o.kind, o.vat_number, o.tax_code, o.address, o.zip, o.city, o.province,
         o.phone, o.email, o.pec, o.website, o.active,
         (x.org_id IS NOT NULL) AS configured, x.letterhead_footer, x.logo, x.logo_mime, o.iban, o.bic, o.bank_name, x.sepa_mandate_id, x.sepa_mandate_date,
         coalesce(x.sepa_first_done, FALSE) AS sepa_first_done, coalesce(x.is_franchisor, FALSE) AS is_franchisor,
         o.created_at, coalesce(x.updated_at, o.updated_at) AS updated_at
    FROM public.organizations o LEFT JOIN org_ext x ON x.org_id = o.id
   WHERE o.kind IN ('SOCIETA', 'GRUPPO');

CREATE VIEW operators_v AS
  SELECT pu.id, cu.id AS cash_user_id, pu.email, pu.full_name, pu.first_name, pu.last_name, pu.person_id, pu.level AS suite_level,
         g.profile AS role, pu.status, (pu.status = 'ACTIVE') AS active, pu.last_login_at,
         coalesce(cu.company_id,
                  (SELECT e.company_id FROM public.grant_scopes gs JOIN site_ext e ON e.site_id = gs.scope_id
                    WHERE gs.grant_id = g.id AND gs.scope_type = 'SITE' ORDER BY gs.scope_id LIMIT 1),
                  (SELECT c.id FROM companies_v c WHERE c.id = pu.organization_id),
                  (SELECT c.id FROM public.grant_scopes gs JOIN companies_v c ON c.id = gs.scope_id
                    WHERE gs.grant_id = g.id AND gs.scope_type = 'ORG' ORDER BY gs.scope_id LIMIT 1)) AS company_id,
         (SELECT coalesce(array_agg(gs.scope_id ORDER BY gs.scope_id), '{}')
            FROM public.grant_scopes gs WHERE gs.grant_id = g.id AND gs.scope_type = 'SITE') AS site_ids,
         x.cash_float
    FROM public.users pu
    JOIN public.grants g ON g.user_id = pu.id AND g.module_key = 'cash' AND NOT g.proposed
    LEFT JOIN users cu ON cu.suite_user_id = pu.id
    LEFT JOIN user_ext x ON x.user_id = pu.id;

CREATE VIEW users_v AS
  SELECT cu.id, cu.suite_user_id, coalesce(pu.email, cu.email) AS email, coalesce(pu.full_name, cu.full_name) AS full_name,
         pu.first_name, pu.last_name, pu.person_id, coalesce(g.profile, cu.role) AS role, cu.company_id,
         coalesce(pu.status = 'ACTIVE', cu.active) AS active, pu.last_login_at, x.cash_float
    FROM users cu
    LEFT JOIN public.users pu ON pu.id = cu.suite_user_id
    LEFT JOIN public.grants g ON g.user_id = pu.id AND g.module_key = 'cash' AND NOT g.proposed
    LEFT JOIN user_ext x ON x.user_id = pu.id;
