-- Anagrafica unica della Suite (docs/ANAGRAFICA.md): le persone esistono una volta sola in public.people, le sedi in public.sites.
-- Contratti del personale è IL modulo HR dell'anagrafica unica: è l'unico modulo (oltre ad Amministrazione > Persone) autorizzato a
-- creare e modificare public.people, con audit della Suite (PERSON_CREATED / PERSON_UPDATED).
-- Spariscono la tabella persone dell'app (resources) e le sedi di lavoro (work_sites). Restano:
--   person_ext    dossier HR riservato della persona (person_id → public.people): residenza, partita IVA, IBAN, matricola,
--                 cellulare aziendale, area organizzativa del modulo e approvatore ferie, CV, cessazione, note HR, note colloquio.
--                 Cognome, nome, titolo, sesso, data di nascita, codice fiscale, email, telefoni, tipo (DIPENDENTE, LP, MEDICO,
--                 SANITARIO, DIRIGENTE), stato (CANDIDATO, IMPEGNO, ATTIVO, CESSATO), responsabile, sede, mansione, disciplina,
--                 ingresso e cessazione vengono da public.people.
--   person_areas  doppie funzioni (ex resource_areas), su public.people.
-- Le colonne resource_id delle tabelle del dossier (employments, lp_contracts, commitment_letters, generated_documents, attachments,
-- deadlines, cv_box, org_units) conservano il nome ma contengono l'id di public.people. areas.head_resource_id diventa head_person_id.
-- La sede di lavoro del contratto e della lettera di impegno è work_site_id → public.sites (al posto del testo libero work_site).
-- Decisione di Francesco (25/10/2026): la Suite parte vuota, nessuna riconciliazione con l'app di origine; i contratti si ricaricano da zero.

DROP TABLE IF EXISTS work_sites CASCADE;
DROP TABLE IF EXISTS resource_areas CASCADE;
DROP TABLE IF EXISTS resources CASCADE;

-- ---------------------------------------------------------------- dossier HR della persona
CREATE TABLE person_ext (
  person_id          INT PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
  birth_place        TEXT,
  vat_number         TEXT,                                   -- partita IVA (liberi professionisti)
  mobile_company     TEXT,                                   -- cellulare aziendale
  address            TEXT,                                   -- residenza: via e civico
  zip                TEXT,
  city               TEXT,
  province           TEXT,
  iban               TEXT,
  badge_number       TEXT,                                   -- matricola / numero badge
  nationality        TEXT,
  emergency_contact  TEXT,
  area_id            INT REFERENCES areas(id) ON DELETE SET NULL,            -- area organizzativa principale (albero del modulo)
  approver_id        INT REFERENCES public.people(id) ON DELETE SET NULL,    -- approva ferie e permessi, se diverso dal responsabile
  cv_attachment_id   INT,                                                    -- FK verso attachments aggiunta sotto
  termination_reason TEXT,
  termination_notes  TEXT,
  interview_notes    TEXT,
  notes              TEXT,                                                   -- note HR riservate
  created_by         INT REFERENCES users(id),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX person_ext_area_idx ON person_ext (area_id);
ALTER TABLE person_ext ADD CONSTRAINT person_ext_cv_fk FOREIGN KEY (cv_attachment_id) REFERENCES attachments(id) ON DELETE SET NULL;

-- Doppie funzioni: una persona può appartenere a più aree (area_id di person_ext resta quella principale)
CREATE TABLE person_areas (
  person_id  INT NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  area_id    INT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, area_id)
);
CREATE INDEX person_areas_area_idx ON person_areas (area_id);

-- ---------------------------------------------------------------- chiavi esterne verso l'anagrafica unica (il DROP CASCADE le ha tolte)
ALTER TABLE employments         ADD CONSTRAINT employments_person_fkey         FOREIGN KEY (resource_id) REFERENCES public.people(id) ON DELETE CASCADE;
ALTER TABLE lp_contracts        ADD CONSTRAINT lp_contracts_person_fkey        FOREIGN KEY (resource_id) REFERENCES public.people(id) ON DELETE CASCADE;
ALTER TABLE commitment_letters  ADD CONSTRAINT commitment_letters_person_fkey  FOREIGN KEY (resource_id) REFERENCES public.people(id) ON DELETE CASCADE;
ALTER TABLE generated_documents ADD CONSTRAINT generated_documents_person_fkey FOREIGN KEY (resource_id) REFERENCES public.people(id) ON DELETE CASCADE;
ALTER TABLE attachments         ADD CONSTRAINT attachments_person_fkey         FOREIGN KEY (resource_id) REFERENCES public.people(id) ON DELETE CASCADE;
ALTER TABLE deadlines           ADD CONSTRAINT deadlines_person_fkey           FOREIGN KEY (resource_id) REFERENCES public.people(id) ON DELETE CASCADE;
ALTER TABLE cv_box              ADD CONSTRAINT cv_box_person_fkey              FOREIGN KEY (resource_id) REFERENCES public.people(id) ON DELETE SET NULL;
ALTER TABLE org_units           ADD CONSTRAINT org_units_person_fkey           FOREIGN KEY (resource_id) REFERENCES public.people(id) ON DELETE SET NULL;

ALTER TABLE areas RENAME COLUMN head_resource_id TO head_person_id;
ALTER TABLE areas ADD CONSTRAINT areas_head_person_fkey FOREIGN KEY (head_person_id) REFERENCES public.people(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- sede di lavoro: public.sites al posto del testo libero
ALTER TABLE employments        DROP COLUMN IF EXISTS work_site, ADD COLUMN work_site_id INT REFERENCES public.sites(id) ON DELETE SET NULL;
ALTER TABLE commitment_letters DROP COLUMN IF EXISTS work_site, ADD COLUMN work_site_id INT REFERENCES public.sites(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- vista con le colonne che il codice dell'app si aspetta da una risorsa
-- kind è la natura del rapporto per il modulo (DIPENDENTE = subordinato, anche per i dirigenti; LP = autonomo, anche medici e
-- sanitari); person_kind è il tipo dell'anagrafica unica. I referenti esterni (ESTERNO) non sono personale e restano fuori.
-- manager_id è public.people.manager_person_id. Le FK restano su public.people: la vista serve solo alle letture.
CREATE VIEW resources_v AS
  SELECT p.id,
         CASE WHEN p.kind IN ('DIPENDENTE', 'DIRIGENTE') THEN 'DIPENDENTE' ELSE 'LP' END AS kind,
         p.kind AS person_kind, p.status, p.last_name, p.first_name, p.sex, p.title, p.birth_date, p.tax_code,
         p.email, p.phone, p.phone_office, p.phone_ext, p.area AS area_label, p.job_title AS person_job_title, p.discipline AS person_discipline,
         p.manager_person_id AS manager_id, p.site_id, p.organization_id, p.photo_file_id, p.hired_at, p.terminated_at, p.needs_review,
         p.created_at, p.updated_at,
         x.birth_place, x.vat_number, x.mobile_company, x.address, x.zip, x.city, x.province, x.iban, x.badge_number, x.nationality, x.emergency_contact,
         x.area_id, x.approver_id, x.cv_attachment_id, x.termination_reason, x.termination_notes, x.interview_notes, x.notes, x.created_by,
         (x.person_id IS NOT NULL) AS in_hr, x.updated_at AS ext_updated_at
    FROM public.people p LEFT JOIN person_ext x ON x.person_id = p.id
   WHERE p.kind <> 'ESTERNO';
