-- Programma "anagrafica unica", blocco 3 (08/11/2026), C5: il beneficiario dei pagamenti si collega (facoltativo) alla Legal entity
-- dell'anagrafica (beneficiaries.org_id): nome e codice fiscale si leggono da lì quando c'è, senza copie scollegate. I beneficiari senza
-- Legal entity (persone, enti occasionali) restano come sono. Non distruttiva: colonna nuova, completata solo dove la P.IVA o il codice
-- fiscale del beneficiario coincidono con una sola Legal entity; gli altri nel rapporto.
ALTER TABLE beneficiaries ADD COLUMN IF NOT EXISTS org_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS beneficiaries_org_idx ON beneficiaries (org_id) WHERE org_id IS NOT NULL;
WITH m AS (
  SELECT b.id, (array_agg(o.id))[1] AS org_id, count(*) AS n FROM beneficiaries b JOIN public.organizations o
      ON regexp_replace(regexp_replace(upper(coalesce(b.tax_id, '')), '[^A-Z0-9]', '', 'g'), '^IT', '') IN (
         regexp_replace(regexp_replace(upper(coalesce(o.vat_number, '')), '[^A-Z0-9]', '', 'g'), '^IT', ''), regexp_replace(upper(coalesce(o.tax_code, '')), '[^A-Z0-9]', '', 'g'))
   WHERE b.org_id IS NULL AND length(regexp_replace(coalesce(b.tax_id, ''), '[^A-Za-z0-9]', '', 'g')) >= 11
   GROUP BY b.id)
UPDATE beneficiaries b SET org_id = m.org_id FROM m WHERE m.id = b.id AND m.n = 1;
INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'finance/005_beneficiari_legal_entity.sql', 'Payments: beneficiari collegati alla Legal entity (C5)',
       jsonb_build_object('beneficiari', (SELECT count(*) FROM beneficiaries), 'collegati', (SELECT count(*) FROM beneficiaries WHERE org_id IS NOT NULL));
