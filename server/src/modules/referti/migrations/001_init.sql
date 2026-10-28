-- Modulo Referti esterni (schema "referti" della Suite, search_path = referti, public).
-- Referti dei laboratori esterni (Bianalisi, Cerba RDI Limena, Cerba Nuova Igea) trascritti sul format Toscana Diagnostica:
-- PDF di partenza → schede per paziente (JSON intermedio) → DOCX e PDF TD, archivio e registro.
-- Nessuna anagrafica propria: chi carica e chi conferma è public.users. Nessun dato del paziente fuori da queste tabelle.

-- Riga tecnica dell'utente del modulo (creata dall'adattatore moduleUser della Suite). Il ruolo è il profilo del grant:
-- LAB (elabora e conferma), QUALITA (registro e impostazioni), VIEWER (consultazione), ADMIN (Owner e Admin della Suite).
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'VIEWER',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un PDF caricato (anche "merge" con più pazienti). Il contenuto sta in data (bytea) oppure su Azure Blob (blob_path).
CREATE TABLE IF NOT EXISTS elaborazioni (
  id             SERIAL PRIMARY KEY,
  filename       TEXT NOT NULL,
  mime           TEXT NOT NULL DEFAULT 'application/pdf',
  size           INT NOT NULL,
  sha256         TEXT NOT NULL,
  data           BYTEA,
  blob_path      TEXT,
  pagine         INT NOT NULL DEFAULT 0,
  sorgente       TEXT,                                  -- BIANALISI, CERBA_RDI, CERBA_NUOVA_IGEA, ALTRO (rilevata)
  stato          TEXT NOT NULL DEFAULT 'CARICATO' CHECK (stato IN ('CARICATO','ELABORATO','SCARTATO')),
  motivo_scarto  TEXT,
  ocr            BOOLEAN NOT NULL DEFAULT FALSE,        -- testo ottenuto con OCR (verifica manuale obbligatoria)
  uploaded_by    INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS elaborazioni_created_idx ON elaborazioni (created_at DESC);

-- Una scheda = un paziente di un PDF (pagine del sorgente), con il JSON intermedio della routine e le anomalie da verificare
CREATE TABLE IF NOT EXISTS schede (
  id               SERIAL PRIMARY KEY,
  elaborazione_id  INT NOT NULL REFERENCES elaborazioni(id) ON DELETE CASCADE,
  pagine           INT[] NOT NULL DEFAULT '{}',
  sorgente         TEXT NOT NULL CHECK (sorgente IN ('BIANALISI','CERBA_RDI','CERBA_NUOVA_IGEA','ALTRO')),
  cognome_nome     TEXT NOT NULL DEFAULT '',
  data_nascita     TEXT,
  sesso            TEXT,
  accettazione     TEXT,
  data_acc         TEXT,
  referto_codice   TEXT,
  referto_data     TEXT,
  dati             JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { anagrafica, settori, esami, antibiogrammi, note, corpo } (modificabile)
  dati_orig        JSONB NOT NULL DEFAULT '{}'::jsonb,   -- uscita del parser, non modificabile: base del controllo di coerenza
  testo_sorgente   TEXT NOT NULL DEFAULT '',              -- testo estratto dalle pagine della scheda (per il controllo di coerenza)
  anomalie         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ codice, testo }]
  stato            TEXT NOT NULL DEFAULT 'BOZZA' CHECK (stato IN ('BOZZA','CONFERMATA','SCARTATA')),
  nome_file        TEXT NOT NULL DEFAULT '',              -- "Referto - COGNOME NOME" (senza estensione)
  sostituisce_id   INT REFERENCES schede(id) ON DELETE SET NULL,   -- scheda il cui file è stato sovrascritto ("annulla e sostituisce")
  sostituita_da    INT REFERENCES schede(id) ON DELETE SET NULL,
  confirmed_by     INT REFERENCES public.users(id) ON DELETE SET NULL,
  confirmed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS schede_elab_idx ON schede (elaborazione_id);
CREATE INDEX IF NOT EXISTS schede_stato_idx ON schede (stato);
CREATE INDEX IF NOT EXISTS schede_nome_idx ON schede (lower(cognome_nome));

-- File prodotti dalla conferma: PDF sorgente (ritaglio delle pagine della scheda oppure rimando al PDF intero
-- dell'elaborazione), DOCX e PDF TD. Contenuto in data oppure su blob; per il rimando entrambi NULL e elaborazione_id valorizzato.
CREATE TABLE IF NOT EXISTS file_prodotti (
  id               SERIAL PRIMARY KEY,
  scheda_id        INT NOT NULL REFERENCES schede(id) ON DELETE CASCADE,
  kind             TEXT NOT NULL CHECK (kind IN ('SORGENTE_PDF','DOCX','PDF')),
  filename         TEXT NOT NULL,
  mime             TEXT NOT NULL,
  size             INT NOT NULL DEFAULT 0,
  sha256           TEXT,
  data             BYTEA,
  blob_path        TEXT,
  elaborazione_id  INT REFERENCES elaborazioni(id) ON DELETE CASCADE,
  intero           BOOLEAN NOT NULL DEFAULT FALSE,        -- PDF sorgente intero (ritaglio non disponibile)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS file_prodotti_scheda_idx ON file_prodotti (scheda_id, kind);

-- Registro delle operazioni (evidenza ISO 9001 del controllo): caricamenti, scarti, correzioni, conferme, sostituzioni
CREATE TABLE IF NOT EXISTS registro (
  id               SERIAL PRIMARY KEY,
  scheda_id        INT REFERENCES schede(id) ON DELETE SET NULL,
  elaborazione_id  INT REFERENCES elaborazioni(id) ON DELETE SET NULL,
  azione           TEXT NOT NULL,
  user_id          INT REFERENCES public.users(id) ON DELETE SET NULL,
  dettagli         JSONB NOT NULL DEFAULT '{}'::jsonb,
  at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS registro_at_idx ON registro (at DESC);

-- Impostazioni del modulo (cartella OneDrive, genera anche PDF, retention, suffisso predefinito)
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  INT
);

-- Template DOCX della carta intestata caricato dalle Impostazioni (header, footer, sectPr sostituiscono quelli predefiniti)
CREATE TABLE IF NOT EXISTS templates (
  id           SERIAL PRIMARY KEY,
  filename     TEXT NOT NULL,
  size         INT NOT NULL,
  sha256       TEXT NOT NULL,
  data         BYTEA NOT NULL,
  attivo       BOOLEAN NOT NULL DEFAULT TRUE,
  uploaded_by  INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
