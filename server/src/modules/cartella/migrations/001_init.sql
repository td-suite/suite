-- Modulo Cartella condivisa (schema "cartella" della Suite, search_path = cartella, public).
-- Cartelle ad albero e documenti visibili a tutti gli utenti con il grant sul modulo (nessun permesso per cartella).
-- Contenuto dei file in BYTEA nello schema del modulo (come gli allegati di Ticket e i documenti di Circolari): l'archivio
-- su Azure Blob (public.files) richiede la connection string e senza di essa risponde 503, quindi non è riutilizzabile
-- nelle installazioni senza Blob. Migrazione su Blob prevista nella fase 2.

-- Riga tecnica dell'utente del modulo (creata dall'adattatore moduleUser della Suite). Ruolo = profilo del grant (ADMIN, VIEWER).
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'VIEWER',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Cartelle ad albero: parent_id NULL = radice
CREATE TABLE IF NOT EXISTS cartelle (
  id                  SERIAL PRIMARY KEY,
  parent_id           INT REFERENCES cartelle(id) ON DELETE CASCADE,
  nome                TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 120),
  descrizione         TEXT NOT NULL DEFAULT '',
  sort_order          INT NOT NULL DEFAULT 100,
  created_by_user_id  INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS cartelle_nome_unica ON cartelle (coalesce(parent_id, 0), lower(nome));
CREATE INDEX IF NOT EXISTS cartelle_parent ON cartelle (parent_id);

-- Documenti: cartella_id NULL = radice. "nome" è il nome mostrato (rinominabile), "filename" quello originale del caricamento.
CREATE TABLE IF NOT EXISTS documenti (
  id                    SERIAL PRIMARY KEY,
  cartella_id           INT REFERENCES cartelle(id) ON DELETE CASCADE,
  nome                  TEXT NOT NULL CHECK (length(nome) BETWEEN 1 AND 200),
  filename              TEXT NOT NULL,
  mime                  TEXT NOT NULL,
  size                  INT NOT NULL,
  data                  BYTEA NOT NULL,
  descrizione           TEXT NOT NULL DEFAULT '',
  in_evidenza           BOOLEAN NOT NULL DEFAULT FALSE,
  evidenza_fino         DATE,
  caricato_da_user_id   INT REFERENCES public.users(id) ON DELETE SET NULL,
  versione              INT NOT NULL DEFAULT 1,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS documenti_nome_unico ON documenti (coalesce(cartella_id, 0), lower(nome));
CREATE INDEX IF NOT EXISTS documenti_cartella ON documenti (cartella_id);
CREATE INDEX IF NOT EXISTS documenti_evidenza ON documenti (in_evidenza, evidenza_fino);
CREATE INDEX IF NOT EXISTS documenti_created ON documenti (created_at DESC);

-- Versioni precedenti di un documento (storico consultabile e scaricabile)
CREATE TABLE IF NOT EXISTS versioni (
  id                    SERIAL PRIMARY KEY,
  documento_id          INT NOT NULL REFERENCES documenti(id) ON DELETE CASCADE,
  versione              INT NOT NULL,
  filename              TEXT NOT NULL,
  mime                  TEXT NOT NULL,
  size                  INT NOT NULL,
  data                  BYTEA NOT NULL,
  caricato_da_user_id   INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (documento_id, versione)
);

-- Letture: prima apertura di un documento per utente ("nuovi per me", "visto da N persone")
CREATE TABLE IF NOT EXISTS letture (
  documento_id  INT NOT NULL REFERENCES documenti(id) ON DELETE CASCADE,
  user_id       INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  letto_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (documento_id, user_id)
);
CREATE INDEX IF NOT EXISTS letture_user ON letture (user_id);

-- Audit del modulo
CREATE TABLE IF NOT EXISTS eventi (
  id            SERIAL PRIMARY KEY,
  tipo          TEXT NOT NULL CHECK (tipo IN ('CARICATO','RINOMINATO','SPOSTATO','ELIMINATO','EVIDENZA','VERSIONE','MODIFICATO','CARTELLA_CREATA','CARTELLA_RINOMINATA','CARTELLA_SPOSTATA','CARTELLA_ELIMINATA')),
  documento_id  INT,            -- senza FK: resta anche dopo l'eliminazione
  cartella_id   INT,
  user_id       INT REFERENCES public.users(id) ON DELETE SET NULL,
  dati          JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventi_doc ON eventi (documento_id, created_at);
CREATE INDEX IF NOT EXISTS eventi_created ON eventi (created_at DESC);

-- Percorso di una cartella ("Procedure / Qualità"), radice esclusa
CREATE OR REPLACE FUNCTION cartella.percorso(cid INT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT c.id, c.parent_id, c.nome, 0 AS depth FROM cartella.cartelle c WHERE c.id = cid
    UNION ALL
    SELECT c.id, c.parent_id, c.nome, up.depth + 1 FROM cartella.cartelle c JOIN up ON c.id = up.parent_id WHERE up.depth < 30
  )
  SELECT string_agg(nome, ' / ' ORDER BY depth DESC) FROM up;
$$;

-- Discendenti (inclusa) di una cartella: per il controllo dei cicli negli spostamenti
CREATE OR REPLACE FUNCTION cartella.discendenti(cid INT) RETURNS TABLE(id INT) LANGUAGE sql STABLE AS $$
  WITH RECURSIVE down AS (
    SELECT c.id, 0 AS depth FROM cartella.cartelle c WHERE c.id = cid
    UNION ALL
    SELECT c.id, down.depth + 1 FROM cartella.cartelle c JOIN down ON c.parent_id = down.id WHERE down.depth < 30
  )
  SELECT id FROM down;
$$;
