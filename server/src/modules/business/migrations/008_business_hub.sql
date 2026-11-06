-- Business Hub (richiesta del CEO, 06/11/2026): il widget "Contratti B2C/B2B" diventa la centrale di registrazione del business.
-- CRM a fasi sulle Legal entity dell'anagrafica unica (public.organizations): un account per Legal entity e linea di business
-- (SRV service di laboratorio, PP punti prelievo, MDL medicina del lavoro), con le 7 fasi del percorso commerciale e le loro date,
-- il diario dei contatti (attività), i referenti, le criticità, i documenti e la posta delle caselle di linea (service@, network@,
-- mdl@). Contratti e fascicoli di autorizzazione restano dove sono e compaiono nella scheda account come "di cui".
-- Regola del cliente attivo: lo dice SOLO il CEO o un Admin del modulo (cliente_attivo, attivo_dal, attivo_da_user); contratti,
-- autorizzazioni e import non lo cambiano mai; la fase 7 (Attivo / Starting) richiede cliente_attivo.
-- Il DB Opportunità del CEO (XLSX, 49 colonne) si importa da Impostazioni: ogni riga non perde nulla (import_raw).

CREATE TABLE IF NOT EXISTS accounts (
  id                    SERIAL PRIMARY KEY,
  organization_id       INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  linea                 TEXT NOT NULL CHECK (linea IN ('SRV','PP','MDL')),
  prospect              BOOLEAN NOT NULL DEFAULT TRUE,          -- potenziale cliente (la Suite non ha un tipo di Legal entity per i prospect)
  gruppo                TEXT,                                   -- gruppo o ente gestore (colonna "Gruppo / Ente Gestore")
  tipologia             TEXT,
  segmento_lab          TEXT,
  discipline            TEXT,
  accreditata_ssr       TEXT,                                   -- Sì / No / vuoto, come nel DB
  fatturato_struttura   NUMERIC(16,2),
  fatturato_struttura_testo TEXT,                               -- quando il DB riporta un testo (es. fatturato del gruppo)
  anno_bilancio         TEXT,
  modalita_contatto     TEXT,
  fornitore_attuale     TEXT,
  situazione_fornitore  TEXT,
  contratto_td          TEXT,                                   -- Sì / No come nel DB (informativo: i contratti veri sono nella tabella contracts)
  listino_riferimento   TEXT,
  priorita              TEXT CHECK (priorita IN ('ALTA','MEDIA','BASSA')),
  fonte_priorita        TEXT,
  stato_cartella        TEXT,
  fase_corrente         INT NOT NULL DEFAULT 0 CHECK (fase_corrente BETWEEN 0 AND 7),   -- 0 = prospect censito, 1..7 = fasi
  phase_dates           JSONB NOT NULL DEFAULT '{}'::jsonb,     -- {"1":"2026-05-04", ..., "7":"2026-07-20"}
  owner_user_id         INT REFERENCES public.users(id) ON DELETE SET NULL,
  prossima_azione       TEXT,
  data_prossima_azione  DATE,
  sconto_medio          NUMERIC(10,6),                          -- frazione (-0,22 = 22% sotto listino), come nel DB
  volume_fy_atteso      NUMERIC(16,2),
  prezzo_medio_esame    NUMERIC(12,2),
  fatturato_fy_atteso   NUMERIC(16,2),
  fatturato_2026        NUMERIC(16,2),
  fatturato_2027        NUMERIC(16,2),
  cliente_attivo        BOOLEAN NOT NULL DEFAULT FALSE,
  attivo_dal            DATE,
  attivo_da_user        INT REFERENCES public.users(id) ON DELETE SET NULL,
  attivo_nota           TEXT,
  note                  TEXT,
  fonte_censimento      TEXT,
  sedi                  JSONB NOT NULL DEFAULT '[]'::jsonb,     -- strutture del gruppo (righe del DB accorpate): nome, indirizzo, città, contatti, valori
  import_key            TEXT,
  import_raw            JSONB,                                  -- righe originali del DB Opportunità, per ID
  created_by            INT REFERENCES users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, linea)
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_import_key_uq ON accounts (import_key) WHERE import_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounts_fase_idx ON accounts (linea, fase_corrente);
CREATE INDEX IF NOT EXISTS accounts_owner_idx ON accounts (owner_user_id);

-- Referenti del cliente: se la persona è già in public.people (con la Legal entity) si collega, senza duplicarla
CREATE TABLE IF NOT EXISTS contatti (
  id          SERIAL PRIMARY KEY,
  account_id  INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  person_id   INT REFERENCES public.people(id) ON DELETE SET NULL,
  nome        TEXT NOT NULL,
  ruolo       TEXT,
  email       TEXT,
  telefono    TEXT,
  principale  BOOLEAN NOT NULL DEFAULT FALSE,
  note        TEXT,
  fonte       TEXT,                                             -- MANUALE, DB_OPPORTUNITA, EMAIL
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contatti_account_idx ON contatti (account_id);
CREATE INDEX IF NOT EXISTS contatti_email_idx ON contatti (lower(email));
CREATE INDEX IF NOT EXISTS contatti_person_idx ON contatti (person_id);

-- Diario: ogni contatto, cosa ci siamo detti, avanzamenti, email in arrivo e in uscita, eventi di sistema
CREATE TABLE IF NOT EXISTS activities (
  id               BIGSERIAL PRIMARY KEY,
  account_id       INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL CHECK (tipo IN ('CHIAMATA','EMAIL_IN','EMAIL_OUT','INCONTRO','SOPRALLUOGO','NOTA','OFFERTA','CRITICITA','SISTEMA')),
  at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id          INT REFERENCES users(id),
  con_chi          TEXT,
  contatto_id      INT REFERENCES contatti(id) ON DELETE SET NULL,
  oggetto          TEXT,
  testo            TEXT,
  esito            TEXT,
  prossima_azione  TEXT,
  data_prossima    DATE,
  contract_id      INT REFERENCES contracts(id) ON DELETE SET NULL,
  nc_ref           TEXT,
  order_ref        TEXT,
  ticket_ref       TEXT,
  email_message_id TEXT,
  graph_id         TEXT,
  email_from       TEXT,
  email_to         TEXT,
  email_cc         TEXT,
  email_stato      TEXT CHECK (email_stato IN ('INVIATO','REGISTRATO','FALLITO','RICEVUTO')),
  email_errore     TEXT,
  fase_da          INT,
  fase_a           INT,
  dati             JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_account_idx ON activities (account_id, at DESC);
CREATE INDEX IF NOT EXISTS activities_at_idx ON activities (at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS activities_graph_uq ON activities (graph_id) WHERE graph_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS activities_import_uq ON activities (account_id, (dati->>'import_key')) WHERE dati ? 'import_key';

-- Criticità manuali (laboratorio, cliente, logistica, amministrazione); le NC del widget NC si leggono dal feed, non si copiano
CREATE TABLE IF NOT EXISTS criticita (
  id           SERIAL PRIMARY KEY,
  account_id   INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  origine      TEXT NOT NULL CHECK (origine IN ('LABORATORIO','CLIENTE','LOGISTICA','AMMINISTRAZIONE','ALTRO')),
  gravita      TEXT NOT NULL DEFAULT 'MEDIA' CHECK (gravita IN ('BASSA','MEDIA','ALTA','CRITICA')),
  titolo       TEXT,
  descrizione  TEXT NOT NULL,
  aperta_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  chiusa_at    TIMESTAMPTZ,
  esito        TEXT,
  user_id      INT REFERENCES users(id),
  chiusa_by    INT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS criticita_account_idx ON criticita (account_id, aperta_at DESC);

-- Posta in arrivo dalle caselle di linea: ogni messaggio letto (abbinato o da assegnare)
CREATE TABLE IF NOT EXISTS email_in (
  id           SERIAL PRIMARY KEY,
  linea        TEXT NOT NULL CHECK (linea IN ('SRV','PP','MDL')),
  casella      TEXT NOT NULL,
  graph_id     TEXT NOT NULL UNIQUE,
  message_id   TEXT,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_email   TEXT,
  from_name    TEXT,
  subject      TEXT,
  preview      TEXT,
  n_allegati   INT NOT NULL DEFAULT 0,
  stato        TEXT NOT NULL DEFAULT 'DA_ASSEGNARE' CHECK (stato IN ('ABBINATO','DA_ASSEGNARE','IGNORATO')),
  come         TEXT,                                            -- criterio di abbinamento (email del referente, dominio, ...)
  account_id   INT REFERENCES accounts(id) ON DELETE SET NULL,
  activity_id  BIGINT REFERENCES activities(id) ON DELETE SET NULL,
  simulato     BOOLEAN NOT NULL DEFAULT FALSE,
  assegnato_by INT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_in_stato_idx ON email_in (stato, received_at DESC);

-- Documenti dell'account: allegati del diario, email in arrivo e caricamenti manuali (archivio del modulo: blob o database)
CREATE TABLE IF NOT EXISTS documenti (
  id           SERIAL PRIMARY KEY,
  account_id   INT REFERENCES accounts(id) ON DELETE CASCADE,
  activity_id  BIGINT REFERENCES activities(id) ON DELETE SET NULL,
  email_in_id  INT REFERENCES email_in(id) ON DELETE CASCADE,
  categoria    TEXT NOT NULL DEFAULT 'ALTRO' CHECK (categoria IN ('ALLEGATO','EMAIL','OFFERTA','VERBALE','ALTRO')),
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size         INT NOT NULL,
  sha256       TEXT NOT NULL,
  data         BYTEA,
  blob_path    TEXT,
  uploaded_by  INT REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (account_id IS NOT NULL OR email_in_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS documenti_account_idx ON documenti (account_id);
CREATE INDEX IF NOT EXISTS documenti_email_idx ON documenti (email_in_id);
CREATE INDEX IF NOT EXISTS documenti_activity_idx ON documenti (activity_id);

-- Revisioni delle proposte: un Admin del modulo modifica anche un contratto FIRMATO/ATTIVO con una nuova revisione (mai sovrascrivere)
CREATE TABLE IF NOT EXISTS contract_revisions (
  id           SERIAL PRIMARY KEY,
  contract_id  INT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  version      INT NOT NULL,                                    -- versione del contratto PRIMA della modifica
  status       TEXT NOT NULL,
  snapshot     JSONB NOT NULL,                                  -- titolo, date, note, data della versione precedente
  motivo       TEXT NOT NULL,
  user_id      INT REFERENCES users(id),
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contract_revisions_idx ON contract_revisions (contract_id, at DESC);

-- Avvisi già notificati (una sola notifica per evento: NC aperta, ordine senza risposta, prossima azione scaduta)
CREATE TABLE IF NOT EXISTS avvisi_inviati (
  chiave  TEXT PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Registro delle importazioni del DB Opportunità (stessa tabella dei pacchetti: kind distingue)
ALTER TABLE import_runs ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'PACK';
