-- v0.77.0 · Gestione del Personale (richiesta del CEO del 16/11/2026): formazione aziendale e crediti ECM, tirocinanti, medicina del lavoro.
-- Idempotente e non distruttiva: solo tabelle nuove, la vista resources_v ricreata con le stesse colonne (cambia solo il valore di kind
-- per i tirocinanti) e il vincolo di dossier_requirements allargato.

-- ---------------------------------------------------------------- tirocinante: terzo tipo di rapporto
CREATE OR REPLACE VIEW resources_v AS
  SELECT p.id,
         CASE WHEN p.kind IN ('DIPENDENTE', 'DIRIGENTE') THEN 'DIPENDENTE' WHEN p.kind = 'TIROCINANTE' THEN 'TIROCINANTE' ELSE 'LP' END AS kind,
         p.kind AS person_kind, p.status, p.last_name, p.first_name, p.sex, p.title, p.birth_date, p.tax_code,
         p.email, p.phone, p.phone_office, p.phone_ext, p.area AS area_label, p.job_title AS person_job_title, p.discipline AS person_discipline,
         p.manager_person_id AS manager_id, p.site_id, p.organization_id, p.photo_file_id, p.hired_at, p.terminated_at, p.needs_review,
         p.created_at, p.updated_at,
         p.birth_place, p.vat_number, x.mobile_company, p.address, p.zip, p.city, p.province, x.iban, x.badge_number, x.nationality, x.emergency_contact,
         x.area_id, x.approver_id, x.cv_attachment_id, x.termination_reason, x.termination_notes, x.interview_notes, x.notes, x.created_by,
         (x.person_id IS NOT NULL) AS in_hr, x.updated_at AS ext_updated_at
    FROM public.people p LEFT JOIN person_ext x ON x.person_id = p.id
   WHERE p.kind <> 'ESTERNO';

ALTER TABLE dossier_requirements DROP CONSTRAINT IF EXISTS dossier_requirements_kind_check;
ALTER TABLE dossier_requirements ADD CONSTRAINT dossier_requirements_kind_check CHECK (kind IN ('DIPENDENTE','LP','TIROCINANTE'));
-- Documenti attesi nel dossier del tirocinante (gli stessi di lib/seedData.js, che li riallinea ogni giorno): qui perché ci siano subito
INSERT INTO dossier_requirements (kind, category, label, required, renew_months, sort_order) VALUES
  ('TIROCINANTE','CONVENZIONE_TIROCINIO','Convenzione di tirocinio (contratto di inserimento)',true,NULL,10),
  ('TIROCINANTE','PROGETTO_FORMATIVO','Progetto formativo individuale firmato',true,NULL,20),
  ('TIROCINANTE','UNILAV','Comunicazione obbligatoria (tirocini extracurriculari)',false,NULL,30),
  ('TIROCINANTE','ASSICURAZIONE_TIROCINIO','Coperture INAIL e responsabilità civile',true,NULL,40),
  ('TIROCINANTE','CI','Documento di identità',true,NULL,50),
  ('TIROCINANTE','CF','Codice fiscale / tessera sanitaria',true,NULL,60),
  ('TIROCINANTE','CV','Curriculum vitae',false,NULL,70),
  ('TIROCINANTE','PRIVACY','Informativa privacy firmata',true,NULL,80),
  ('TIROCINANTE','MOD231','Modello 231, Codice Etico e Codice di Condotta',true,NULL,90),
  ('TIROCINANTE','FORMAZIONE_SICUREZZA','Formazione sicurezza (D.Lgs. 81/2008)',true,60,100),
  ('TIROCINANTE','VISITA_MEDICA','Idoneità sanitaria (medico competente)',false,12,110),
  ('TIROCINANTE','REGISTRO_PRESENZE','Registro delle presenze',false,NULL,120),
  ('TIROCINANTE','VALUTAZIONE_TIROCINIO','Scheda di valutazione e giudizio finale',false,NULL,130),
  ('TIROCINANTE','ATTESTAZIONE_TIROCINIO','Attestazione finale del tirocinio',false,NULL,140),
  ('TIROCINANTE','FORMAZIONE','Attestati di formazione',false,NULL,150),
  ('TIROCINANTE','ALTRO','Altro',false,NULL,900)
ON CONFLICT (kind, category) DO NOTHING;

-- Un tirocinio per persona (come employments e lp_contracts): convenzione con l'ente promotore, progetto formativo individuale,
-- tutor aziendale, giudizio finale. I documenti firmati stanno nel dossier (categorie CONVENZIONE_TIROCINIO, PROGETTO_FORMATIVO, ...).
CREATE TABLE IF NOT EXISTS tirocini (
  resource_id        INT PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
  tipo               TEXT NOT NULL DEFAULT 'EXTRACURRICULARE' CHECK (tipo IN ('CURRICULARE','EXTRACURRICULARE','PROFESSIONALIZZANTE','ALTRO')),
  ente_promotore     TEXT,
  ente_email         TEXT,
  tutor_ente         TEXT,
  convenzione_numero TEXT,
  convenzione_data   DATE,
  start_date         DATE,
  end_date           DATE,
  weekly_hours       NUMERIC(5,2),
  indennita_mensile  NUMERIC(10,2),
  work_site_id       INT REFERENCES public.sites(id) ON DELETE SET NULL,
  tutor_person_id    INT REFERENCES public.people(id) ON DELETE SET NULL,
  obiettivi          TEXT,
  pf_stato           TEXT NOT NULL DEFAULT 'DA_RICHIEDERE' CHECK (pf_stato IN ('DA_RICHIEDERE','RICHIESTO','RICEVUTO','FIRMATO')),
  pf_richiesto_il    DATE,
  pf_ricevuto_il     DATE,
  pf_firmato_il      DATE,
  giudizio_esito     TEXT CHECK (giudizio_esito IS NULL OR giudizio_esito IN ('POSITIVO','POSITIVO_CON_RISERVA','NEGATIVO','INTERROTTO')),
  giudizio_data      DATE,
  giudizio_note      TEXT,
  giudizio_da        INT REFERENCES public.people(id) ON DELETE SET NULL,
  notes              TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

-- ---------------------------------------------------------------- formazione aziendale ed ECM
-- Una riga per corso: svolto (data) o programmato (data_prevista). crediti_ecm alimenta il contatore del triennio; scadenza è la data
-- entro cui il corso va rinnovato (aggiornamenti sicurezza, BLSD, ...). L'attestato è un allegato del dossier.
CREATE TABLE IF NOT EXISTS formazione (
  id             SERIAL PRIMARY KEY,
  resource_id    INT NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL DEFAULT 'AZIENDALE',
  titolo         TEXT NOT NULL,
  ente           TEXT,
  stato          TEXT NOT NULL DEFAULT 'SVOLTA' CHECK (stato IN ('PROGRAMMATA','SVOLTA')),
  data           DATE,                          -- data di conseguimento (corsi svolti)
  data_prevista  DATE,                          -- corsi programmati
  ore            NUMERIC(6,2),
  crediti_ecm    NUMERIC(6,2) NOT NULL DEFAULT 0,
  scadenza       DATE,
  obbligatoria   BOOLEAN NOT NULL DEFAULT FALSE,
  codice_evento  TEXT,                          -- ECM: codice evento / provider, se leggibile sull'attestato
  attachment_id  INT REFERENCES attachments(id) ON DELETE SET NULL,
  fonte          TEXT NOT NULL DEFAULT 'MANUALE' CHECK (fonte IN ('MANUALE','ATTESTATO')),
  lettura        JSONB,                         -- ciò che la lettura automatica dell'attestato ha proposto (tracciabilità)
  note           TEXT,
  created_by     INT REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS formazione_persona ON formazione (resource_id);

-- Posizione ECM della persona: soggetto NULL = automatico (professione sanitaria riconosciuta da tipo, mansione o disciplina).
CREATE TABLE IF NOT EXISTS ecm_profili (
  resource_id      INT PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
  soggetto         BOOLEAN,
  professione      TEXT,
  obbligo_triennio NUMERIC(6,2),                 -- NULL = obbligo generale delle Impostazioni
  riduzione        NUMERIC(6,2) NOT NULL DEFAULT 0,   -- esoneri, esenzioni, bonus riconosciuti
  riduzione_motivo TEXT,
  note             TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- medicina del lavoro (D.Lgs. 81/2008, art. 41)
-- In Suite stanno SOLO il giudizio di idoneità alla mansione con le eventuali prescrizioni o limitazioni e il calendario delle visite:
-- mai diagnosi, esiti di accertamenti o cartella sanitaria e di rischio, che restano al medico competente.
CREATE TABLE IF NOT EXISTS mdl_protocolli (
  id                SERIAL PRIMARY KEY,
  nome              TEXT NOT NULL UNIQUE,
  mansioni          TEXT,
  rischi            TEXT,
  accertamenti      TEXT,
  periodicita_mesi  INT NOT NULL DEFAULT 12 CHECK (periodicita_mesi BETWEEN 1 AND 120),
  attivo            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mdl_schede (
  resource_id       INT PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
  sorveglianza      BOOLEAN NOT NULL DEFAULT TRUE,
  protocollo_id     INT REFERENCES mdl_protocolli(id) ON DELETE SET NULL,
  mansione          TEXT,
  rischi            TEXT,
  periodicita_mesi  INT CHECK (periodicita_mesi IS NULL OR periodicita_mesi BETWEEN 1 AND 120),
  medico_competente TEXT,
  note              TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mdl_visite (
  id              SERIAL PRIMARY KEY,
  resource_id     INT NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL DEFAULT 'PERIODICA' CHECK (tipo IN ('PREVENTIVA','PERIODICA','CAMBIO_MANSIONE','RIENTRO','RICHIESTA_LAVORATORE','CESSAZIONE','STRAORDINARIA')),
  stato           TEXT NOT NULL DEFAULT 'PROGRAMMATA' CHECK (stato IN ('PROGRAMMATA','CONVOCATA','EFFETTUATA','ANNULLATA','NON_PRESENTATO')),
  data_prevista   DATE,
  ora             TEXT,
  luogo           TEXT,
  medico          TEXT,
  data_visita     DATE,
  giudizio        TEXT CHECK (giudizio IS NULL OR giudizio IN ('IDONEO','IDONEO_PRESCRIZIONI','IDONEO_LIMITAZIONI','NON_IDONEO_TEMPORANEO','NON_IDONEO_PERMANENTE')),
  prescrizioni    TEXT,
  scadenza        DATE,                           -- prossima visita entro
  attachment_id   INT REFERENCES attachments(id) ON DELETE SET NULL,
  convocazione_id INT,
  note            TEXT,
  created_by      INT REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mdl_visite_persona ON mdl_visite (resource_id);
CREATE TABLE IF NOT EXISTS mdl_convocazioni (
  id          SERIAL PRIMARY KEY,
  data        DATE NOT NULL,
  ora         TEXT,
  luogo       TEXT,
  medico      TEXT,
  note        TEXT,
  persone     INT NOT NULL DEFAULT 0,
  inviate     INT NOT NULL DEFAULT 0,
  esiti       JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
