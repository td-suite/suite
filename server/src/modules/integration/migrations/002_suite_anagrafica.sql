-- Anagrafica unica (docs/ANAGRAFICA.md): la società target di un'acquisizione è un'organizzazione della Suite
-- (public.organizations, kind TARGET; al closing l'Amministrazione la trasforma in SOCIETA e il piano resta agganciato).
-- Le persone del team di integrazione (owner e support delle attività) sono persone della Suite (public.people).
-- Le tabelle targets e team del modulo spariscono: restano target_ext (parametri del piano) e person_ext (ruolo nel piano).
-- La Suite parte vuota: i dati di prova (attività, snapshot, registro) vengono azzerati, nessuna copia dall'app di origine.

DROP TABLE IF EXISTS activities CASCADE;
DROP TABLE IF EXISTS targets CASCADE;
DROP TABLE IF EXISTS team CASCADE;
DROP TABLE IF EXISTS "session" CASCADE;   -- le sessioni sono della Suite
TRUNCATE snapshots, audit_log;

-- Estensione Integration dell'organizzazione target: i soli campi del piano. Nome, ragione sociale, P.IVA, indirizzo,
-- telefono, email, sito e PEC vengono da public.organizations (Amministrazione > Organizzazioni).
CREATE TABLE target_ext (
  org_id     INT PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  position   INT NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'ATTIVO' CHECK (status IN ('ATTIVO','SOSPESO','CONCLUSO')),
  ref        TEXT NOT NULL DEFAULT '',   -- persona di riferimento presso la target
  fatt       TEXT NOT NULL DEFAULT '',   -- fatturato (numerico o stringa vuota, come nell'app originale)
  pfn        TEXT NOT NULL DEFAULT '',   -- posizione finanziaria netta
  ev         TEXT NOT NULL DEFAULT '',   -- enterprise value
  linee      JSONB NOT NULL DEFAULT '[]'::jsonb,   -- linee di attività (lab, img, spec, lav, chir, altro)
  loi        TEXT NOT NULL DEFAULT '',   -- date ISO (YYYY-MM-DD) o stringa vuota
  prelim     TEXT NOT NULL DEFAULT '',
  closing    TEXT NOT NULL DEFAULT '',
  hor        INT NOT NULL DEFAULT 24,    -- orizzonte del GANTT in settimane
  note       TEXT NOT NULL DEFAULT '',
  lm         BIGINT NOT NULL DEFAULT 0,  -- last-modified lato client (ms epoch)
  version    INT NOT NULL DEFAULT 1,
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Estensione Integration della persona: ruolo nel piano (es. CEO, Legal & Compliance), funzione interna/esterna, colore.
-- Nome, email, telefono e stato vengono da public.people (Amministrazione > Persone).
CREATE TABLE person_ext (
  person_id  INT PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
  position   INT NOT NULL DEFAULT 0,
  r          TEXT NOT NULL DEFAULT '',          -- ruolo nel piano
  f          TEXT NOT NULL DEFAULT 'Interna' CHECK (f IN ('Interna','Esterna')),
  color      TEXT,
  lm         BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Attività del GANTT (l'id è univoco dentro la target). Owner = persona dell'anagrafica unica.
CREATE TABLE activities (
  target_id  INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  position   INT NOT NULL DEFAULT 0,
  cid        TEXT NOT NULL DEFAULT '',   -- codice catalogo (G1, O2, 1.1 ...) o 'nuova'
  nome       JSONB,                      -- null (nome da catalogo), stringa, oppure {it,en}
  proc       TEXT NOT NULL DEFAULT 'ops',
  sw         INT NOT NULL DEFAULT 0,
  ew         INT NOT NULL DEFAULT 0,
  owner_id   INT REFERENCES public.people(id) ON DELETE SET NULL,
  dett       TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  st         INT NOT NULL DEFAULT 0 CHECK (st BETWEEN 0 AND 3),
  pl         BOOLEAN NOT NULL DEFAULT FALSE,
  ms         BOOLEAN NOT NULL DEFAULT FALSE,
  fine       TEXT NOT NULL DEFAULT '',
  lm         BIGINT NOT NULL DEFAULT 0,
  version    INT NOT NULL DEFAULT 1,
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (target_id, id)
);
CREATE INDEX activities_target_pos_idx ON activities (target_id, position);
CREATE INDEX activities_owner_idx ON activities (owner_id);

-- Ownership support: le persone che affiancano l'owner su un'attività
CREATE TABLE activity_support (
  target_id   INT NOT NULL,
  activity_id TEXT NOT NULL,
  person_id   INT NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  position    INT NOT NULL DEFAULT 0,
  PRIMARY KEY (target_id, activity_id, person_id),
  FOREIGN KEY (target_id, activity_id) REFERENCES activities(target_id, id) ON DELETE CASCADE
);
CREATE INDEX activity_support_person_idx ON activity_support (person_id);

-- Vista con le colonne che il motore del piano si aspetta dalla vecchia tabella targets (nome, rs, ind, piva, tel, mail, web, pec ...)
CREATE VIEW targets_v AS
  SELECT o.id, o.kind, o.code, o.name AS nome, o.name AS rs,
         trim(both ' ,' from concat_ws(', ', nullif(o.address, ''), nullif(concat_ws(' ', nullif(o.zip, ''), nullif(o.city, '')), ''), nullif(o.province, ''))) AS ind,
         coalesce(o.vat_number, '') AS piva, coalesce(o.phone, '') AS tel, coalesce(o.email, '') AS mail, coalesce(o.website, '') AS web, coalesce(o.pec, '') AS pec,
         o.active,
         x.position, x.status, x.ref, x.fatt, x.pfn, x.ev, x.linee, x.loi, x.prelim, x.closing, x.hor, x.note, x.lm, x.version, x.updated_by, x.updated_at, x.created_at
    FROM public.organizations o JOIN target_ext x ON x.org_id = o.id;

-- Team di integrazione: le persone dell'anagrafica con il loro ruolo nel piano
CREATE VIEW team_v AS
  SELECT p.id AS person_id, x.position, x.r, x.f, x.color, x.lm,
         p.last_name || ' ' || p.first_name AS n, p.first_name, p.last_name, p.email, p.job_title, p.status AS person_status
    FROM person_ext x JOIN public.people p ON p.id = x.person_id;
