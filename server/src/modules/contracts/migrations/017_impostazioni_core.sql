-- Impostazioni senza doppia compilazione (richiesta del CEO, 27/10/2026, docs/IMPOSTAZIONI.md). Luogo di nascita, partita IVA
-- e residenza (via, CAP, città, provincia) sono dati personali dell'anagrafica unica dal 25/10/2026 (migrazione core 018:
-- public.people.birth_place, vat_number, address, zip, city, province): il dossier HR non li duplica più. I valori esistenti
-- completano il core dove manca, poi le colonne di person_ext spariscono; resources_v li legge da public.people.
-- Restano nel dossier HR: cellulare aziendale, IBAN, matricola, nazionalità, contatto per emergenze, area, approvatore, CV, note.
UPDATE public.people p SET
  birth_place = coalesce(p.birth_place, nullif(x.birth_place, '')),
  vat_number  = coalesce(p.vat_number, nullif(x.vat_number, '')),
  address     = coalesce(p.address, nullif(x.address, '')),
  zip         = coalesce(p.zip, nullif(x.zip, '')),
  city        = coalesce(p.city, nullif(x.city, '')),
  province    = coalesce(p.province, nullif(x.province, '')),
  updated_at  = now()
  FROM person_ext x WHERE x.person_id = p.id
    AND (x.birth_place IS NOT NULL OR x.vat_number IS NOT NULL OR x.address IS NOT NULL OR x.zip IS NOT NULL OR x.city IS NOT NULL OR x.province IS NOT NULL);

DROP VIEW IF EXISTS resources_v;
ALTER TABLE person_ext DROP COLUMN IF EXISTS birth_place, DROP COLUMN IF EXISTS vat_number, DROP COLUMN IF EXISTS address,
  DROP COLUMN IF EXISTS zip, DROP COLUMN IF EXISTS city, DROP COLUMN IF EXISTS province;

CREATE VIEW resources_v AS
  SELECT p.id,
         CASE WHEN p.kind IN ('DIPENDENTE', 'DIRIGENTE') THEN 'DIPENDENTE' ELSE 'LP' END AS kind,
         p.kind AS person_kind, p.status, p.last_name, p.first_name, p.sex, p.title, p.birth_date, p.tax_code,
         p.email, p.phone, p.phone_office, p.phone_ext, p.area AS area_label, p.job_title AS person_job_title, p.discipline AS person_discipline,
         p.manager_person_id AS manager_id, p.site_id, p.organization_id, p.photo_file_id, p.hired_at, p.terminated_at, p.needs_review,
         p.created_at, p.updated_at,
         p.birth_place, p.vat_number, x.mobile_company, p.address, p.zip, p.city, p.province, x.iban, x.badge_number, x.nationality, x.emergency_contact,
         x.area_id, x.approver_id, x.cv_attachment_id, x.termination_reason, x.termination_notes, x.interview_notes, x.notes, x.created_by,
         (x.person_id IS NOT NULL) AS in_hr, x.updated_at AS ext_updated_at
    FROM public.people p LEFT JOIN person_ext x ON x.person_id = p.id
   WHERE p.kind <> 'ESTERNO';
