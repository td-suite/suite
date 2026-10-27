-- Impostazioni senza doppia compilazione (richiesta del CEO, 27/10/2026, docs/IMPOSTAZIONI.md). Business non chiede più le
-- coordinate bancarie della controparte: org_ext.iban e org_ext.bank_name duplicavano quelle di Cash e ora sono della Legal
-- entity (public.organizations.iban, bic, bank_name, migrazione core 026, Amministrazione > Legal entity). I valori esistenti
-- completano il core dove manca, poi le colonne spariscono; la vista orgs_v espone iban, bic e bank_name dal core.
UPDATE public.organizations o SET iban = x.iban, updated_at = now() FROM org_ext x WHERE x.org_id = o.id AND o.iban IS NULL AND x.iban IS NOT NULL AND x.iban <> '';
UPDATE public.organizations o SET bank_name = x.bank_name, updated_at = now() FROM org_ext x WHERE x.org_id = o.id AND o.bank_name IS NULL AND x.bank_name IS NOT NULL AND x.bank_name <> '';

DROP VIEW IF EXISTS orgs_v;
ALTER TABLE org_ext DROP COLUMN IF EXISTS iban, DROP COLUMN IF EXISTS bank_name;

CREATE VIEW orgs_v AS
  SELECT o.id, o.kind, o.code, o.name, o.vat_number AS vat, o.tax_code, o.sdi, o.address AS street, o.zip, o.city, o.province AS prov,
         o.email, o.phone, o.pec, o.website, o.active, o.needs_review,
         (x.org_id IS NOT NULL) AS configured,
         x.legal_rep, x.signer, x.signer_role, x.contract_services, x.lab_reference, x.billing_ref,
         x.sales_contact, x.sales_email, x.sales_phone,
         x.svc_contact, x.svc_email, x.svc_mobile, x.svc_address, x.proc_contact, x.proc_email, x.proc_mobile, x.proc_address,
         x.pay_method, x.pay_terms, coalesce(x.currency, 'EUR') AS currency, coalesce(x.withholding, FALSE) AS withholding,
         x.vat_territoriality, x.intent_declaration, coalesce(x.split_payment, FALSE) AS split_payment, x.tax_values,
         o.bank_name, o.iban, o.bic, x.portal_url, x.portal_username, (x.portal_password_enc IS NOT NULL) AS has_portal_password,
         x.notes AS business_notes, o.notes,
         o.created_at, coalesce(x.updated_at, o.updated_at) AS updated_at
    FROM public.organizations o LEFT JOIN org_ext x ON x.org_id = o.id;
