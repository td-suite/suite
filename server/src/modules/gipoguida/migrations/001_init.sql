-- Guida GIPO (schema "gipoguida" della Suite, search_path = gipoguida, public). v0.70.0, richiesta del CEO del 12/11/2026: guida completa di
-- GipoNext, FAQ, ricerca full text e domande con risposta (docs/GIPO_GUIDA.md). I contenuti nascono dal seme versionato
-- server/src/modules/gipoguida/content/ (analisi dell'interfaccia del 12/11/2026) e si arricchiscono con le risposte degli amministratori
-- alle domande del personale. Nessun dato dei pazienti: le domande si salvano dopo il mascheramento di codici fiscali, telefoni ed email.
-- Migrazione idempotente: IF NOT EXISTS ovunque.

-- Riga tecnica dell'utente del modulo (adattatore moduleUser della Suite): il ruolo è il profilo del grant (ADMIN | LETTORE)
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'LETTORE',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Impostazioni e stato tecnico del modulo (chiave → valore JSON): stato del seme, ultimo riepilogo settimanale
CREATE TABLE IF NOT EXISTS impostazioni (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Capitoli della guida (dal seme: un file per capitolo)
CREATE TABLE IF NOT EXISTS capitoli (
  numero     INT PRIMARY KEY CHECK (numero BETWEEN 0 AND 99),
  titolo     TEXT NOT NULL,
  intro      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Sezioni della guida. seme_hash = impronta del testo del seme caricato l'ultima volta: se il contenuto attuale ha ancora quella impronta
-- la sezione non è stata toccata a mano e un rilascio con un seme diverso la aggiorna; altrimenti (modificata a mano o VALIDATA) resta com'è.
CREATE TABLE IF NOT EXISTS sezioni (
  id             SERIAL PRIMARY KEY,
  capitolo       INT NOT NULL,
  ordine         INT NOT NULL DEFAULT 0,
  titolo         TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  corpo          TEXT NOT NULL DEFAULT '',
  percorso_gipo  TEXT,
  parole_chiave  TEXT,
  stato          TEXT NOT NULL DEFAULT 'DA_VALIDARE' CHECK (stato IN ('VALIDATA', 'DA_VALIDARE')),
  origine        TEXT NOT NULL DEFAULT 'SEME' CHECK (origine IN ('SEME', 'REDAZIONE')),
  seme_hash      TEXT,
  validata_il    TIMESTAMPTZ,
  validata_da    INT REFERENCES public.users(id) ON DELETE SET NULL,
  aggiornata_il  TIMESTAMPTZ NOT NULL DEFAULT now(),
  aggiornata_da  INT REFERENCES public.users(id) ON DELETE SET NULL,
  creata_il      TIMESTAMPTZ NOT NULL DEFAULT now(),
  tsv            tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('italian'::regconfig, coalesce(titolo, '')), 'A') ||
    setweight(to_tsvector('italian'::regconfig, coalesce(parole_chiave, '')), 'A') ||
    setweight(to_tsvector('italian'::regconfig, coalesce(percorso_gipo, '')), 'C') ||
    setweight(to_tsvector('italian'::regconfig, coalesce(corpo, '')), 'B')
  ) STORED
);
CREATE INDEX IF NOT EXISTS sezioni_tsv ON sezioni USING GIN (tsv);
CREATE INDEX IF NOT EXISTS sezioni_capitolo ON sezioni (capitolo, ordine);

-- Storico delle modifiche alle sezioni: la versione PRECEDENTE alla modifica, chi e perché (MANUALE, SEME, RIPRISTINO, STATO)
CREATE TABLE IF NOT EXISTS revisioni (
  id            SERIAL PRIMARY KEY,
  sezione_id    INT NOT NULL REFERENCES sezioni(id) ON DELETE CASCADE,
  titolo        TEXT NOT NULL,
  corpo         TEXT NOT NULL,
  percorso_gipo TEXT,
  parole_chiave TEXT,
  stato         TEXT NOT NULL,
  fonte         TEXT NOT NULL DEFAULT 'MANUALE' CHECK (fonte IN ('MANUALE', 'SEME', 'RIPRISTINO', 'STATO')),
  nota          TEXT,
  autore        INT REFERENCES public.users(id) ON DELETE SET NULL,
  creata_il     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS revisioni_sezione ON revisioni (sezione_id, creata_il DESC);

-- FAQ: dal seme (origine SEME, seme_chiave stabile) o dalle risposte degli amministratori alle domande del personale (DOMANDA_UTENTE)
CREATE TABLE IF NOT EXISTS faq (
  id            SERIAL PRIMARY KEY,
  domanda       TEXT NOT NULL,
  risposta      TEXT NOT NULL,
  sezione_id    INT REFERENCES sezioni(id) ON DELETE SET NULL,
  ordine        INT NOT NULL DEFAULT 0,
  origine       TEXT NOT NULL DEFAULT 'SEME' CHECK (origine IN ('SEME', 'DOMANDA_UTENTE', 'REDAZIONE')),
  ruolo         TEXT,
  pubblicata    BOOLEAN NOT NULL DEFAULT TRUE,
  seme_chiave   TEXT UNIQUE,
  seme_hash     TEXT,
  aggiornata_il TIMESTAMPTZ NOT NULL DEFAULT now(),
  aggiornata_da INT REFERENCES public.users(id) ON DELETE SET NULL,
  creata_il     TIMESTAMPTZ NOT NULL DEFAULT now(),
  tsv           tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('italian'::regconfig, coalesce(domanda, '')), 'A') ||
    setweight(to_tsvector('italian'::regconfig, coalesce(risposta, '')), 'B')
  ) STORED
);
CREATE INDEX IF NOT EXISTS faq_tsv ON faq USING GIN (tsv);
CREATE INDEX IF NOT EXISTS faq_sezione ON faq (sezione_id);

-- Domande del personale (pagina Chiedi): testo già mascherato, risposta, fonti usate, esito, valutazione di chi ha chiesto, coda della
-- redazione (SENZA_RISPOSTA o "non utile", non ancora risolte o chiuse)
CREATE TABLE IF NOT EXISTS domande (
  id                 SERIAL PRIMARY KEY,
  utente             INT REFERENCES public.users(id) ON DELETE SET NULL,
  testo              TEXT NOT NULL,
  mascherati         TEXT[] NOT NULL DEFAULT '{}',
  risposta           TEXT,
  fonti              JSONB NOT NULL DEFAULT '[]',
  modello            TEXT,
  esito              TEXT NOT NULL CHECK (esito IN ('RISPOSTA', 'SENZA_RISPOSTA', 'SOLO_RICERCA')),
  utile              BOOLEAN,
  nota_utente        TEXT,
  valutata_il        TIMESTAMPTZ,
  presa_in_carico_da INT REFERENCES public.users(id) ON DELETE SET NULL,
  presa_in_carico_il TIMESTAMPTZ,
  risolta_con_faq_id INT REFERENCES faq(id) ON DELETE SET NULL,
  risolta_il         TIMESTAMPTZ,
  risolta_da         INT REFERENCES public.users(id) ON DELETE SET NULL,
  chiusa_il          TIMESTAMPTZ,
  chiusa_nota        TEXT,
  creata_il          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS domande_utente ON domande (utente, creata_il DESC);
CREATE INDEX IF NOT EXISTS domande_coda ON domande (creata_il) WHERE risolta_il IS NULL AND chiusa_il IS NULL;

-- Ricerche (barra della guida e delle FAQ): testo mascherato e numero di risultati, per le statistiche (argomenti più cercati, ricerche
-- senza risultati). Le battute successive della stessa ricerca aggiornano la riga invece di aggiungerne una nuova.
CREATE TABLE IF NOT EXISTS ricerche (
  id         SERIAL PRIMARY KEY,
  utente     INT REFERENCES public.users(id) ON DELETE SET NULL,
  testo      TEXT NOT NULL,
  risultati  INT NOT NULL DEFAULT 0,
  creata_il  TIMESTAMPTZ NOT NULL DEFAULT now(),
  aggiornata_il TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ricerche_quando ON ricerche (creata_il DESC);
CREATE INDEX IF NOT EXISTS ricerche_utente ON ricerche (utente, aggiornata_il DESC);
