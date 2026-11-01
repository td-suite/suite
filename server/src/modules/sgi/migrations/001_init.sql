-- Modulo Portale SGI (schema "sgi" della Suite, search_path = sgi, public). Widget HQS "SGI Management".
-- Copia conforme del sito pubblico sgi.toscanadiagnostica.it: la fonte resta il sito (routine RSGI, build\aggiorna_portale.bat), la
-- Suite ne tiene uno SPECCHIO di sola lettura. Nessun contenuto si modifica qui: si gestiscono origine, credenziali dell'origine,
-- aggiornamento e cache dei file. Stesse tabelle del Portale Service (meccanica comune in server/src/lib/specchioPortale.js).

-- Riga tecnica dell'utente del modulo (adattatore moduleUser della Suite). Ruolo = profilo del grant: LETTORE (implicito per tutti,
-- modulo aperto a tutti gli autenticati), EDITOR (Impostazioni, Aggiorna adesso, ZIP, cache); Owner e Admin della Suite = EDITOR.
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'LETTORE',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- I JSON del sito di origine (data/*.json), così come sono: meta, docs, preparazioni, fulltext.
-- sha256 = sha del JSON canonico (chiavi ordinate): uguale che arrivi dal sito o dallo ZIP del repo.
CREATE TABLE IF NOT EXISTS contenuti (
  chiave      TEXT PRIMARY KEY,
  json        JSONB NOT NULL,
  sha256      TEXT NOT NULL,
  bytes       INT NOT NULL DEFAULT 0,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Stato dello specchio (una riga sola)
CREATE TABLE IF NOT EXISTS stato (
  id               INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  build            TEXT,                      -- meta.build del sito (es. "30/10/2026 07:44")
  reg006_rev       TEXT,
  reg006_data      TEXT,
  fonte            TEXT,                      -- ORIGINE | ZIP: da dove viene lo specchio in uso
  origine_usata    TEXT,                      -- URL letto all'ultimo aggiornamento (o nome dello ZIP)
  ultima_lettura   TIMESTAMPTZ,               -- ultima lettura riuscita dell'origine (anche senza cambiamenti)
  ultimo_cambio    TIMESTAMPTZ,               -- ultima sostituzione dei contenuti
  ultimi_motivi    JSONB,                     -- perché è cambiato (build, JSON modificati)
  ultimo_errore    TEXT,
  ultimo_errore_at TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO stato (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Impostazioni del modulo: origine dello specchio (SGI_PORTAL_URL prevale), utente HTTP Basic dell'origine e password cifrata
-- AES-256-GCM ({"enc": "v1...."}, lib/secrets.js, come le altre credenziali della Suite; SGI_PORTAL_USER/SGI_PORTAL_PASSWORD prevalgono).
CREATE TABLE IF NOT EXISTS impostazioni (
  chiave      TEXT PRIMARY KEY,
  valore      JSONB,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  INT REFERENCES public.users(id) ON DELETE SET NULL
);

-- Cache dei file (PDF di docs e stampabili): scaricati a richiesta dal sito o importati dallo ZIP. Archivio a due vie
-- (lib/moduleStorage.js): Azure Blob se configurato, altrimenti bytea. Chiave = percorso sul sito.
CREATE TABLE IF NOT EXISTS file_cache (
  percorso     TEXT PRIMARY KEY,
  mime         TEXT NOT NULL DEFAULT 'application/pdf',
  size         INT NOT NULL,
  sha256       TEXT NOT NULL,
  data         BYTEA,
  blob_path    TEXT,
  build        TEXT,                          -- build dello specchio a cui il file appartiene
  fonte        TEXT NOT NULL DEFAULT 'ORIGINE',   -- ORIGINE | ZIP
  hits         INT NOT NULL DEFAULT 0,
  last_hit_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
