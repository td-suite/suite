-- 31/10/2026, richiesta del CEO: casella template@toscanadiagnostica.it in lettura, invio automatico del referto riprodotto al mittente
-- della mail, riapertura dei referti emessi.

-- Origine dell'elaborazione: UPLOAD (caricata dall'Inbox) o CASELLA (allegato PDF di una mail arrivata a template@).
-- Per le mail: id Graph del messaggio, mittente, oggetto, data di ricezione, Message-ID internet. Un allegato già importato
-- (stesso messaggio e stesso contenuto) non si importa due volte.
ALTER TABLE elaborazioni ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'UPLOAD';
ALTER TABLE elaborazioni DROP CONSTRAINT IF EXISTS elaborazioni_origine_check;
ALTER TABLE elaborazioni ADD CONSTRAINT elaborazioni_origine_check CHECK (origine IN ('UPLOAD','CASELLA'));
ALTER TABLE elaborazioni ADD COLUMN IF NOT EXISTS graph_id TEXT;
ALTER TABLE elaborazioni ADD COLUMN IF NOT EXISTS from_email TEXT;
ALTER TABLE elaborazioni ADD COLUMN IF NOT EXISTS from_name TEXT;
ALTER TABLE elaborazioni ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE elaborazioni ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE elaborazioni ADD COLUMN IF NOT EXISTS message_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS elaborazioni_graph_sha_uq ON elaborazioni (graph_id, sha256) WHERE graph_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS elaborazioni_origine_idx ON elaborazioni (origine);

-- Messaggi letti dalla casella (anche quelli senza PDF, ignorati): evita di rileggerli e resta come traccia
CREATE TABLE IF NOT EXISTS messaggi_casella (
  graph_id      TEXT PRIMARY KEY,
  message_id    TEXT,
  received_at   TIMESTAMPTZ,
  from_email    TEXT,
  from_name     TEXT,
  subject       TEXT,
  n_pdf         INT NOT NULL DEFAULT 0,
  esito         TEXT NOT NULL,                       -- IMPORTATO | IGNORATO | DUPLICATO | ERRORE
  dettaglio     TEXT,
  simulato      BOOLEAN NOT NULL DEFAULT FALSE,      -- POST /inbox/simula (solo fuori produzione)
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messaggi_casella_at_idx ON messaggi_casella (at DESC);

-- Riapertura di un referto emesso: la scheda torna BOZZA con i file prodotti conservati finché non si riconferma; alla nuova
-- conferma i file si rigenerano e si sostituiscono (stessa scheda, versione + 1)
ALTER TABLE schede ADD COLUMN IF NOT EXISTS versione INT NOT NULL DEFAULT 1;
ALTER TABLE schede ADD COLUMN IF NOT EXISTS riaperta_at TIMESTAMPTZ;
ALTER TABLE schede ADD COLUMN IF NOT EXISTS riaperta_by INT REFERENCES public.users(id) ON DELETE SET NULL;

-- Invii del referto (PDF prodotto) al mittente della mail: automatici (user_id NULL) o manuali ("Invia al mittente", "Reinvia").
-- stato: INVIATO (Graph), REGISTRATO (posta in modalità registro, MAIL_PROVIDER=log), FALLITO (con errore leggibile)
CREATE TABLE IF NOT EXISTS invii (
  id           SERIAL PRIMARY KEY,
  scheda_id    INT NOT NULL REFERENCES schede(id) ON DELETE CASCADE,
  to_email     TEXT NOT NULL,
  from_email   TEXT,
  stato        TEXT NOT NULL CHECK (stato IN ('INVIATO','REGISTRATO','FALLITO')),
  message_id   TEXT,                                   -- riga del registro email della Suite (email_log:<id>)
  errore       TEXT,
  file_sha256  TEXT,                                   -- PDF inviato: mai due volte lo stesso file allo stesso destinatario senza azione esplicita
  versione     INT,
  automatico   BOOLEAN NOT NULL DEFAULT FALSE,
  user_id      INT REFERENCES public.users(id) ON DELETE SET NULL,
  at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invii_scheda_idx ON invii (scheda_id, at DESC);

-- confirmed_by NULL con azione CONFERMATA_AUTO nel registro: conferma automatica di una scheda arrivata dalla casella (coerenza verde,
-- nessuna anomalia)
COMMENT ON COLUMN schede.confirmed_by IS 'Chi ha confermato; NULL per la conferma automatica (registro CONFERMATA_AUTO)';
