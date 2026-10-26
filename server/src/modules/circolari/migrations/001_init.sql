-- Modulo Circolari aziendali (schema "circolari" della Suite, search_path = circolari, public).
-- Registro unico delle circolari con protocollo progressivo annuale TD-AAAA/NNN, contenuto strutturato (JSON),
-- DOCX e PDF generati dal motore di impaginazione, archivio con ricerca full-text sul contenuto, liste di distribuzione e invii.

-- Riga tecnica dell'utente del modulo (creata dall'adattatore moduleUser della Suite)
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'VIEWER',    -- ADMIN | PUBBLICATORE | REDATTORE | VIEWER (profilo del grant Suite)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS circolari (
  id              SERIAL PRIMARY KEY,
  anno            INT,                                  -- anno del protocollo (assegnato alla pubblicazione)
  numero          INT,                                  -- progressivo annuale (assegnato alla pubblicazione)
  revisione       INT NOT NULL DEFAULT 0,               -- 0 = emissione, 1.. = revisioni successive dello stesso protocollo
  protocollo      TEXT,                                 -- TD-2026/012 (revisioni: TD-2026/012-r1)
  parent_id       INT REFERENCES circolari(id) ON DELETE SET NULL,   -- circolare di cui questa è revisione
  stato           TEXT NOT NULL DEFAULT 'BOZZA' CHECK (stato IN ('BOZZA','PUBBLICATA','SUPERATA','ANNULLATA')),
  tipo            TEXT NOT NULL DEFAULT 'Comunicazione ai clienti',   -- prima riga della fascia
  linea           TEXT NOT NULL DEFAULT 'Laboratorio di Analisi',     -- seconda riga della fascia
  segmento        TEXT NOT NULL DEFAULT 'CLIENTI_SERVICE' CHECK (segmento IN ('CLIENTI_SERVICE','PUNTI_PRELIEVO','MEDICINA_LAVORO','PERSONALE','PARTNER','ALTRO')),
  titolo          TEXT NOT NULL,                        -- titolo grande sotto i metadati
  destinatari     TEXT NOT NULL DEFAULT '',
  oggetto         TEXT NOT NULL DEFAULT '',             -- riga "Oggetto" dei metadati
  decorrenza      TEXT NOT NULL DEFAULT '',
  riferimenti     TEXT NOT NULL DEFAULT '',
  luogo           TEXT NOT NULL DEFAULT 'Sesto Fiorentino (FI)',
  data            DATE NOT NULL DEFAULT CURRENT_DATE,
  sintesi         TEXT NOT NULL DEFAULT '',
  corpo           JSONB NOT NULL DEFAULT '[]',          -- blocchi: paragrafo | titolo | elenco | tabella
  corpo_testo     TEXT NOT NULL DEFAULT '',             -- resa testuale del corpo (ricerca ed estratti), calcolata dal server
  contatti        JSONB NOT NULL DEFAULT '[]',          -- righe del box "Per informazioni"
  firma_nome      TEXT NOT NULL DEFAULT 'Francesco Epifani',
  firma_ruolo     TEXT NOT NULL DEFAULT 'Chief Executive Officer',
  orientamento    TEXT NOT NULL DEFAULT 'AUTO' CHECK (orientamento IN ('AUTO','VERTICALE','ORIZZONTALE')),
  orientamento_eff TEXT,                                -- orientamento effettivo usato nell'ultima impaginazione
  audience        JSONB NOT NULL DEFAULT '{"type":"INTERNAL"}',   -- perimetro nell'indice di ricerca della Suite
  pub_token       TEXT UNIQUE,                          -- segmento dell'URL pubblico (QR code), assegnato alla pubblicazione
  docx            BYTEA,
  pdf             BYTEA,
  pdf_pages       INT,
  render_at       TIMESTAMPTZ,
  render_error    TEXT,
  sorgente_nome   TEXT,                                 -- nome del file caricato (bozza grezza)
  sorgente_testo  TEXT,                                 -- testo estratto dalla bozza grezza
  note_interne    TEXT NOT NULL DEFAULT '',
  created_by      INT,                                  -- users.id della Suite (public.users)
  updated_by      INT,
  published_by    INT,
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- indice full-text sul contenuto (titolo, oggetto, sintesi, corpo, destinatari, riferimenti, testo della bozza)
  fts             TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('italian', coalesce(protocollo,'') || ' ' || coalesce(titolo,'')), 'A') ||
    setweight(to_tsvector('italian', coalesce(oggetto,'') || ' ' || coalesce(sintesi,'') || ' ' || coalesce(destinatari,'') || ' ' || coalesce(riferimenti,'')), 'B') ||
    setweight(to_tsvector('italian', coalesce(corpo_testo,'')), 'C') ||
    setweight(to_tsvector('italian', coalesce(sorgente_testo,'')), 'D')
  ) STORED
);
CREATE UNIQUE INDEX IF NOT EXISTS circolari_protocollo_rev ON circolari (anno, numero, revisione) WHERE numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS circolari_fts ON circolari USING GIN (fts);
CREATE INDEX IF NOT EXISTS circolari_stato ON circolari (stato, data DESC);

-- Liste di distribuzione: destinatari esterni (clienti service, punti prelievo, medici del lavoro) e interni
CREATE TABLE IF NOT EXISTS liste (
  id            SERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,
  descrizione   TEXT NOT NULL DEFAULT '',
  segmento      TEXT NOT NULL DEFAULT 'CLIENTI_SERVICE',
  destinatari   JSONB NOT NULL DEFAULT '[]',            -- [{ email, nome, organizzazione }]
  attiva        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    INT,
  updated_by    INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Invii: ogni spedizione di una circolare a una lista (o a destinatari indicati a mano)
CREATE TABLE IF NOT EXISTS invii (
  id             SERIAL PRIMARY KEY,
  circolare_id   INT NOT NULL REFERENCES circolari(id) ON DELETE CASCADE,
  lista_id       INT REFERENCES liste(id) ON DELETE SET NULL,
  destinatari    JSONB NOT NULL DEFAULT '[]',
  n_destinatari  INT NOT NULL DEFAULT 0,
  n_inviati      INT NOT NULL DEFAULT 0,
  n_errori       INT NOT NULL DEFAULT 0,
  esito          JSONB NOT NULL DEFAULT '[]',           -- [{ email, ok, error }]
  oggetto_email  TEXT,
  inviato_da     INT,
  inviato_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invii_circolare ON invii (circolare_id, inviato_at DESC);

-- Registro delle letture pubbliche (QR code): solo conteggio, nessun dato personale
CREATE TABLE IF NOT EXISTS letture (
  id             SERIAL PRIMARY KEY,
  circolare_id   INT NOT NULL REFERENCES circolari(id) ON DELETE CASCADE,
  letto_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS letture_circolare ON letture (circolare_id);

-- Impostazioni del modulo (chiave/valore)
CREATE TABLE IF NOT EXISTS impostazioni (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
