-- Anagrafica unica della Suite (docs/ANAGRAFICA.md): sedi e persone esistono una volta sola in public.sites e public.people.
-- Spariscono le anagrafiche dell'app (strutture, user_strutture, professionisti) e gli inviti (l'accesso lo gestisce la Suite).
-- Restano le due tabelle di estensione con i soli campi operativi di Room Planning:
--   site_ext    impostazioni Room della sede: documento JSON (ambulatori, personale pianificato, orari, desk, marker della
--               planimetria, email del site manager, note) e versione. Denominazione, indirizzo, telefono, email e site manager
--               vengono da public.sites. Planimetrie e cronologia restano in struttura_blobs / struttura_history, agganciate a public.sites.
--   person_ext  scheda Room della persona: tipo (medico | sanitario), profilo professionale, dati operativi (compenso, contratto,
--               assicurazione, professionale, sedi abilitate, recapiti integrativi, note). Nome, cognome, titolo, email, telefono,
--               codice fiscale, disciplina e stato vengono da public.people (kind MEDICO, SANITARIO, LP, DIPENDENTE).
-- Le colonne prof_id delle tabelle operative (turni, presenze, rendiconti, candidature, disponibilita) conservano il nome ma
-- contengono l'id di public.people; professionista_docs usa person_id. Le colonne sede_id / struttura_id diventano INT su public.sites.
-- Il perimetro degli utenti (ex user_strutture) viene dagli scope del grant Suite (req.user.site_ids).

DROP TABLE IF EXISTS user_strutture CASCADE;
DROP TABLE IF EXISTS inviti CASCADE;
DROP TABLE IF EXISTS strutture CASCADE;
DROP TABLE IF EXISTS professionisti CASCADE;

-- I dati copiati in MIRROR hanno ancora gli id dell'app di origine: si svuotano e il travaso successivo li ricopia tradotti
TRUNCATE struttura_blobs, struttura_history, eventi, email_log, turni, turni_mesi, presenze, rendiconti, posizioni, candidature, disponibilita, professionista_docs CASCADE;

-- ---------------------------------------------------------------- sedi
CREATE TABLE site_ext (
  site_id     INT PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  version     INT NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  INT REFERENCES users(id)
);

-- Binari (logo, planimetria PDF, immagine della planimetria): la colonna conserva il nome struttura_id ma contiene l'id di public.sites
ALTER TABLE struttura_blobs ALTER COLUMN struttura_id TYPE INT USING NULL;
ALTER TABLE struttura_blobs ADD CONSTRAINT struttura_blobs_site_fkey FOREIGN KEY (struttura_id) REFERENCES public.sites(id) ON DELETE CASCADE;
ALTER TABLE struttura_history ALTER COLUMN struttura_id TYPE INT USING NULL;
ALTER TABLE struttura_history ADD CONSTRAINT struttura_history_site_fkey FOREIGN KEY (struttura_id) REFERENCES public.sites(id) ON DELETE CASCADE;

ALTER TABLE eventi ALTER COLUMN sede_id TYPE INT USING NULL;
ALTER TABLE eventi ADD CONSTRAINT eventi_sede_fkey FOREIGN KEY (sede_id) REFERENCES public.sites(id) ON DELETE CASCADE;
ALTER TABLE email_log ALTER COLUMN sede_id TYPE INT USING NULL;
ALTER TABLE email_log ADD CONSTRAINT email_log_sede_fkey FOREIGN KEY (sede_id) REFERENCES public.sites(id) ON DELETE SET NULL;
ALTER TABLE turni ALTER COLUMN sede_id TYPE INT USING NULL;
ALTER TABLE turni ADD CONSTRAINT turni_sede_fkey FOREIGN KEY (sede_id) REFERENCES public.sites(id);
ALTER TABLE presenze ALTER COLUMN sede_id TYPE INT USING NULL;
ALTER TABLE presenze ADD CONSTRAINT presenze_sede_fkey FOREIGN KEY (sede_id) REFERENCES public.sites(id);
ALTER TABLE posizioni ALTER COLUMN sede_id TYPE INT USING NULL;
ALTER TABLE posizioni ADD CONSTRAINT posizioni_sede_fkey FOREIGN KEY (sede_id) REFERENCES public.sites(id) ON DELETE SET NULL;

-- Vista con le colonne che il codice si aspetta da una sede: anagrafica da public.sites, impostazioni Room da site_ext
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.short_name, s.kind, s.address, s.zip, s.city, s.province, s.phone, s.email, s.manager_name, s.active, s.sort_order,
         e.data, e.version, e.created_at, e.updated_at, e.updated_by, (e.site_id IS NOT NULL) AS configurata
    FROM public.sites s LEFT JOIN site_ext e ON e.site_id = s.id;

-- ---------------------------------------------------------------- persone
CREATE TABLE person_ext (
  person_id   INT PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('medico','sanitario')),
  profilo     TEXT,
  dati        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  INT REFERENCES users(id)
);

ALTER TABLE professionista_docs RENAME COLUMN prof_id TO person_id;
ALTER TABLE professionista_docs ADD CONSTRAINT professionista_docs_person_fkey FOREIGN KEY (person_id) REFERENCES public.people(id) ON DELETE CASCADE;
ALTER TABLE disponibilita ADD CONSTRAINT disponibilita_person_fkey FOREIGN KEY (prof_id) REFERENCES public.people(id) ON DELETE CASCADE;
ALTER TABLE turni ADD CONSTRAINT turni_person_fkey FOREIGN KEY (prof_id) REFERENCES public.people(id);
ALTER TABLE presenze ADD CONSTRAINT presenze_person_fkey FOREIGN KEY (prof_id) REFERENCES public.people(id);
ALTER TABLE rendiconti ADD CONSTRAINT rendiconti_person_fkey FOREIGN KEY (prof_id) REFERENCES public.people(id);
ALTER TABLE candidature ADD CONSTRAINT candidature_person_fkey FOREIGN KEY (prof_id) REFERENCES public.people(id) ON DELETE CASCADE;

-- Vista con le colonne che il codice si aspetta da un professionista: anagrafica da public.people, scheda Room da person_ext.
-- tipo e profilo, se la scheda Room non li ha ancora, derivano dal tipo di persona (MEDICO, LP con disciplina = medico) e dalla qualifica.
CREATE VIEW professionisti_v AS
  SELECT p.id, p.last_name || ' ' || p.first_name AS nome, p.last_name, p.first_name, p.kind, p.status, p.title,
         COALESCE(e.tipo, CASE WHEN p.kind = 'MEDICO' OR (p.kind = 'LP' AND coalesce(p.discipline, '') <> '') THEN 'medico' ELSE 'sanitario' END) AS tipo,
         COALESCE(e.profilo, NULLIF(p.job_title, ''), CASE WHEN p.kind = 'MEDICO' THEN 'Medico' END) AS profilo,
         p.email, p.phone, p.phone_office, p.tax_code, p.discipline, p.job_title, p.sex, p.birth_date, p.site_id,
         (p.status IN ('ATTIVO', 'IMPEGNO')) AS attivo,
         COALESCE(e.dati, '{}'::jsonb) AS dati,
         (e.person_id IS NOT NULL) AS in_room, e.created_at, e.updated_at, e.updated_by
    FROM public.people p LEFT JOIN person_ext e ON e.person_id = p.id
   WHERE p.kind IN ('MEDICO', 'SANITARIO', 'LP', 'DIPENDENTE');
