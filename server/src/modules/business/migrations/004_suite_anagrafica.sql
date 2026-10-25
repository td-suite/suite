-- Anagrafica unica (docs/ANAGRAFICA.md): le controparti dei contratti (strutture ospitanti dei punti prelievo, locatori,
-- clienti del service e della medicina del lavoro) sono le organizzazioni della Suite (public.organizations); le sedi dei
-- punti prelievo e le sedi TD in locazione sono le sedi della Suite (public.sites). La tabella partners del modulo sparisce:
-- restano in org_ext i soli campi commerciali di Business (firmatario, riferimenti di servizio e approvvigionamento,
-- condizioni di pagamento, banca, credenziali del portale cifrate con BUSINESS_CREDENTIALS_KEY, note).
-- La Suite parte vuota: i dati di prova dei contratti vengono azzerati (nessuna riconciliazione con l'app di origine).
-- Con la tabella partners sparisce anche l'importazione dello status quo (pacchetti ZIP con anagrafiche).

DROP TABLE IF EXISTS partners CASCADE;
DROP TABLE IF EXISTS import_runs CASCADE;

-- Azzeramento dei contratti di prova (i partner_id non hanno più significato)
TRUNCATE contracts, protocol_counters CASCADE;

ALTER TABLE contracts DROP COLUMN IF EXISTS import_key;
ALTER TABLE contracts DROP COLUMN IF EXISTS partner_id;
ALTER TABLE contracts ADD COLUMN org_id  INT NOT NULL REFERENCES public.organizations(id);
ALTER TABLE contracts ADD COLUMN site_id INT REFERENCES public.sites(id);
-- punti prelievo e sedi TD in locazione parlano sempre di una sede dell'anagrafica
ALTER TABLE contracts ADD CONSTRAINT contracts_site_required_check CHECK (kind NOT IN ('PP', 'SEDE') OR site_id IS NOT NULL);
CREATE INDEX contracts_org_idx ON contracts (org_id);
CREATE INDEX contracts_site_idx ON contracts (site_id);

-- Estensione Business dell'organizzazione (tracciato TD-SGI-MOD173, senza i dati anagrafici che stanno in public.organizations)
CREATE TABLE org_ext (
  org_id              INT PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_rep           TEXT,                          -- legale rappresentante
  signer              TEXT,                          -- firmatario del contratto (se diverso)
  signer_role         TEXT,                          -- qualifica del firmatario
  contract_services   TEXT,                          -- "Servizi a contratto"
  lab_reference       TEXT,                          -- laboratorio di riferimento
  billing_ref         TEXT,                          -- riferimento fatturazione
  sales_contact       TEXT, sales_email TEXT, sales_phone TEXT,                   -- referente commerciale TD
  svc_contact         TEXT, svc_email TEXT, svc_mobile TEXT, svc_address TEXT,    -- riferimenti per la gestione del servizio
  proc_contact        TEXT, proc_email TEXT, proc_mobile TEXT, proc_address TEXT, -- riferimenti per l'approvvigionamento
  pay_method          TEXT,
  pay_terms           TEXT,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  withholding         BOOLEAN NOT NULL DEFAULT FALSE,
  vat_territoriality  TEXT,
  intent_declaration  TEXT,
  split_payment       BOOLEAN NOT NULL DEFAULT FALSE,
  tax_values          TEXT,
  bank_name           TEXT,
  iban                TEXT,
  portal_url          TEXT,                          -- credenziali del portale a livello di organizzazione (AES-256-GCM)
  portal_username     TEXT,
  portal_password_enc TEXT,
  notes               TEXT,
  created_by          INT REFERENCES users(id),
  updated_by          INT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vista con le colonne che il codice dell'app si aspettava dalla vecchia tabella partners (name, vat, street, prov, ...):
-- tutte le organizzazioni dell'anagrafica, con i campi Business da org_ext. Le FK restano su public.organizations.
CREATE VIEW orgs_v AS
  SELECT o.id, o.kind, o.code, o.name, o.vat_number AS vat, o.tax_code, o.sdi, o.address AS street, o.zip, o.city, o.province AS prov,
         o.email, o.phone, o.pec, o.website, o.active, o.needs_review,
         (x.org_id IS NOT NULL) AS configured,
         x.legal_rep, x.signer, x.signer_role, x.contract_services, x.lab_reference, x.billing_ref,
         x.sales_contact, x.sales_email, x.sales_phone,
         x.svc_contact, x.svc_email, x.svc_mobile, x.svc_address, x.proc_contact, x.proc_email, x.proc_mobile, x.proc_address,
         x.pay_method, x.pay_terms, coalesce(x.currency, 'EUR') AS currency, coalesce(x.withholding, FALSE) AS withholding,
         x.vat_territoriality, x.intent_declaration, coalesce(x.split_payment, FALSE) AS split_payment, x.tax_values,
         x.bank_name, x.iban, x.portal_url, x.portal_username, (x.portal_password_enc IS NOT NULL) AS has_portal_password,
         x.notes AS business_notes, o.notes,
         o.created_at, coalesce(x.updated_at, o.updated_at) AS updated_at
    FROM public.organizations o LEFT JOIN org_ext x ON x.org_id = o.id;
