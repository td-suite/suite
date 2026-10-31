-- Casella People (people@toscanadiagnostica.it): richiami automatici sulle scadenze e lettura della casella con approvazione.
-- deadline_reminders: registro degli invii, uno per scadenza (chiave TD-SCAD) e soglia di anticipo, per non ripetere lo stesso richiamo.
-- people_inbox / people_inbox_files: messaggi con allegati arrivati alla casella, in attesa che CEO o HR Manager approvino l'upload
-- nel dossier e la chiusura della scadenza. Nessun upload automatico: tutto nasce DA_APPROVARE.
-- deadline_closures: chiusure delle scadenze calcolate (prova, contratto, polizza ...) registrate all'approvazione.

CREATE TABLE IF NOT EXISTS deadline_reminders (
  id           BIGSERIAL PRIMARY KEY,
  deadline_key TEXT NOT NULL,
  resource_id  INT REFERENCES public.people(id) ON DELETE CASCADE,
  deadline_type TEXT,
  title        TEXT,
  due_date     DATE NOT NULL,
  days_before  INT NOT NULL,                       -- soglia di anticipo raggiunta (60, 30, 7, 0)
  recipient    TEXT NOT NULL DEFAULT 'PERSONA' CHECK (recipient IN ('PERSONA','HR')),
  to_email     TEXT,
  cc_email     TEXT,
  from_email   TEXT,
  channel      TEXT NOT NULL DEFAULT 'EMAIL',      -- EMAIL (Graph) o REGISTRO (MAIL_PROVIDER=log)
  status       TEXT NOT NULL DEFAULT 'INVIATO' CHECK (status IN ('INVIATO','REGISTRATO','FALLITO','SENZA_DESTINATARIO')),
  error        TEXT,
  message_id   TEXT,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deadline_key, days_before)
);
CREATE INDEX IF NOT EXISTS deadline_reminders_res_idx ON deadline_reminders (resource_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS deadline_reminders_at_idx ON deadline_reminders (sent_at DESC);

CREATE TABLE IF NOT EXISTS people_inbox (
  id           SERIAL PRIMARY KEY,
  graph_id     TEXT NOT NULL UNIQUE,               -- id del messaggio Graph (o SIM-... per la simulazione di collaudo)
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_email   TEXT,
  from_name    TEXT,
  subject      TEXT,
  body_text    TEXT,
  resource_id  INT REFERENCES public.people(id) ON DELETE SET NULL,
  deadline_key TEXT,
  match_method TEXT,                               -- TD-SCAD, EMAIL, NOME, MANUALE
  status       TEXT NOT NULL DEFAULT 'DA_APPROVARE' CHECK (status IN ('DA_APPROVARE','APPROVATO','RIFIUTATO','IGNORATO')),
  decided_by   INT REFERENCES users(id),
  decided_at   TIMESTAMPTZ,
  note         TEXT,
  source       TEXT NOT NULL DEFAULT 'GRAPH' CHECK (source IN ('GRAPH','SIMULAZIONE')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS people_inbox_status_idx ON people_inbox (status, received_at DESC);
CREATE INDEX IF NOT EXISTS people_inbox_res_idx ON people_inbox (resource_id);

CREATE TABLE IF NOT EXISTS people_inbox_files (
  id                  SERIAL PRIMARY KEY,
  inbox_id            INT NOT NULL REFERENCES people_inbox(id) ON DELETE CASCADE,
  filename            TEXT NOT NULL,
  mime                TEXT NOT NULL,
  size                INT NOT NULL,
  sha256              TEXT,
  data                BYTEA,                       -- archivio a due vie: database se il blob della Suite non è configurato
  blob_path           TEXT,
  proposed_category   TEXT,
  proposed_expires_at DATE,
  proposed_holder     TEXT,
  confidence          NUMERIC(3,2),
  quote               TEXT,
  method              TEXT,                        -- claude, mock, euristica, nessuna
  approved_category   TEXT,
  approved_expires_at DATE,
  include             BOOLEAN NOT NULL DEFAULT TRUE,
  attachment_id       INT REFERENCES attachments(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS people_inbox_files_inbox_idx ON people_inbox_files (inbox_id);

CREATE TABLE IF NOT EXISTS deadline_closures (
  deadline_key TEXT PRIMARY KEY,
  resource_id  INT REFERENCES public.people(id) ON DELETE CASCADE,
  inbox_id     INT REFERENCES people_inbox(id) ON DELETE SET NULL,
  note         TEXT,
  closed_by    INT REFERENCES users(id),
  closed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Provenienza degli allegati del dossier arrivati dalla casella e allegato sostituito dal rinnovo (la vecchia scadenza si chiude)
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS inbox_id INT REFERENCES people_inbox(id) ON DELETE SET NULL;
ALTER TABLE attachments ADD COLUMN IF NOT EXISTS superseded_by INT REFERENCES attachments(id) ON DELETE SET NULL;

INSERT INTO app_settings (key, value) VALUES
  ('people_mailbox', 'people@toscanadiagnostica.it'),
  ('people_send_enabled', 'false'),
  ('people_read_enabled', 'true'),
  ('people_reminder_days', '60,30,7,0'),
  ('people_hr_cc', ''),
  ('people_reminder_map', '{"DOCUMENTO":"PERSONA","PROVA":"HR","CONTRATTO":"HR","MANUALE":"HR","IMPEGNO":"HR","RAL":"HR","MBO":"HR"}')
ON CONFLICT (key) DO NOTHING;
