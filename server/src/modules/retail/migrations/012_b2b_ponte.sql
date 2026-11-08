-- Programma "anagrafica unica", blocco 3 (08/11/2026), B15: i clienti B2B di Retail sono i clienti attivi della Suite
-- (public.clienti_attivi_v, Service e Medicina del Lavoro). customers con kind = 'B2B' diventa il PONTE tra il codice cliente di
-- StudioLAB (external_code) e la Legal entity dell'anagrafica (organization_id), con i soli campi di Retail (segmento b2b_type,
-- settore, note); i campi anagrafici (ragione sociale, P.IVA, indirizzo, email, telefono) si leggono dal core (vista b2b_v).
-- Migrazione NON distruttiva: nessuna riga cancellata, nessun campo svuotato (i campi anagrafici già presenti restano come "nome nel
-- file" per i codici da abbinare). Nessun abbinamento automatico qui: lo fa la Diagnostica (D21a "Abbina dai codici StudioLAB", con
-- conferma) o l'import delle vendite per i codici nuovi.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS abbinamento TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS abbinato_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS abbinato_by INT REFERENCES public.users(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_abbinamento_check') THEN
    ALTER TABLE customers ADD CONSTRAINT customers_abbinamento_check CHECK (abbinamento IS NULL OR abbinamento IN ('AUTO','MANUALE','DA_ABBINARE'));
  END IF;
END $$;
-- stato iniziale del ponte: abbinati (già collegati a una Legal entity) = MANUALE, gli altri DA_ABBINARE (solo la colonna nuova)
UPDATE customers SET abbinamento = CASE WHEN organization_id IS NOT NULL THEN 'MANUALE' ELSE 'DA_ABBINARE' END WHERE kind = 'B2B' AND abbinamento IS NULL;
CREATE INDEX IF NOT EXISTS customers_b2b_code_idx ON customers (lower(external_code)) WHERE kind = 'B2B';

-- Vista del ponte: campi anagrafici dalla Legal entity quando il codice è abbinato (dal file altrimenti), livello di cliente della Suite
CREATE OR REPLACE VIEW b2b_v AS
  SELECT c.id, c.external_code, c.organization_id, c.abbinamento, c.abbinato_at,
         coalesce(o.name, c.company_name) AS company_name, c.company_name AS nome_nel_file,
         coalesce(o.vat_number, c.vat_number) AS vat_number, coalesce(o.address, c.address) AS address, coalesce(o.zip, c.zip) AS zip,
         coalesce(o.city, c.city) AS city, coalesce(o.province, c.province) AS province, coalesce(o.email, c.email) AS email, coalesce(o.phone, c.phone) AS phone,
         o.kind AS organization_kind, o.active AS organization_active,
         CASE WHEN c.organization_id IS NOT NULL THEN public.cliente_livello(c.organization_id) END AS cliente_livello,
         c.b2b_type, c.sector, c.notes, c.group_name, c.demo, c.first_visit, c.last_visit, c.visits, c.revenue, c.source, c.created_at
    FROM customers c LEFT JOIN public.organizations o ON o.id = c.organization_id
   WHERE c.kind = 'B2B';

INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'retail/012_b2b_ponte.sql', 'Retail: clienti B2B come ponte codice StudioLAB → Legal entity (B15)',
       jsonb_build_object(
         'b2b_totali', (SELECT count(*) FROM customers WHERE kind = 'B2B' AND NOT demo),
         'b2b_abbinati', (SELECT count(*) FROM customers WHERE kind = 'B2B' AND NOT demo AND organization_id IS NOT NULL),
         'b2b_da_abbinare', (SELECT count(*) FROM customers WHERE kind = 'B2B' AND NOT demo AND organization_id IS NULL),
         'da_abbinare_con_sede_dello_stesso_codice', (SELECT count(*) FROM customers c WHERE c.kind = 'B2B' AND NOT c.demo AND c.organization_id IS NULL
            AND EXISTS (SELECT 1 FROM public.sites s WHERE lower(s.studiolab_code) = lower(c.external_code) AND s.organization_id IS NOT NULL)),
         'abbinati_a_legal_entity_diversa_dalla_sede_d21b', (SELECT count(*) FROM customers c JOIN public.sites s ON lower(s.studiolab_code) = lower(c.external_code)
            WHERE c.kind = 'B2B' AND c.organization_id IS DISTINCT FROM s.organization_id AND c.organization_id IS NOT NULL));
