-- Business Hub · Ricerca prospect (v0.74.0, CEO 15/11/2026): scoperta delle strutture da OpenStreetMap, profilo dal loro sito (anagrafica
-- e segnali), key people ed email, coorti e punteggio, promozione in pipeline. Metodi ispirati al progetto open source Sellbird,
-- riscritti da zero per la Suite (nessun codice di terzi). Ogni dato porta la pagina da cui è stato letto (provenienza, GDPR).
CREATE TABLE IF NOT EXISTS scout_ricerche (
  id          SERIAL PRIMARY KEY,
  linea       TEXT NOT NULL CHECK (linea IN ('SRV','PP','MDL')),
  province    TEXT[] NOT NULL DEFAULT '{}',
  categorie   TEXT[] NOT NULL DEFAULT '{}',
  stato       TEXT NOT NULL DEFAULT 'IN_CORSO' CHECK (stato IN ('IN_CORSO','FATTA','ERRORE')),
  trovati     INT NOT NULL DEFAULT 0,
  nuovi       INT NOT NULL DEFAULT 0,
  errore      TEXT,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finita_at   TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS scout_candidati (
  id              SERIAL PRIMARY KEY,
  ricerca_id      INT REFERENCES scout_ricerche(id) ON DELETE SET NULL,
  linea           TEXT NOT NULL CHECK (linea IN ('SRV','PP','MDL')),
  fonte           TEXT NOT NULL CHECK (fonte IN ('OSM','MANUALE','ACCOUNT')),
  fonte_ref       TEXT NOT NULL,                       -- OSM: node/123; MANUALE: dominio o nome; ACCOUNT: id dell'account
  nome            TEXT NOT NULL,
  categoria       TEXT,
  indirizzo       TEXT, cap TEXT, comune TEXT, provincia TEXT,
  lat             DOUBLE PRECISION, lon DOUBLE PRECISION,
  telefono        TEXT, email TEXT, pec TEXT, piva TEXT, cf TEXT,
  sito            TEXT, dominio TEXT,
  operatore       TEXT,                                -- gestore o gruppo dichiarato dalla fonte
  tags            JSONB NOT NULL DEFAULT '{}'::jsonb,   -- dati grezzi della fonte
  stato           TEXT NOT NULL DEFAULT 'NUOVO' CHECK (stato IN ('NUOVO','PROFILATO','SCARTATO','PROMOSSO')),
  profilo         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- pagine lette, anagrafica trovata con la pagina di provenienza
  segnali         JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { CHIAVE: { valore, evidenza, url } }
  punteggio       INT,
  profilato_at    TIMESTAMPTZ,
  errore_profilo  TEXT,
  organization_id INT REFERENCES public.organizations(id) ON DELETE SET NULL,   -- Legal entity già in anagrafica (abbinamento) o creata
  account_id      INT REFERENCES accounts(id) ON DELETE SET NULL,
  abbinato_come   TEXT,
  scartato_motivo TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (linea, fonte, fonte_ref)
);
CREATE INDEX IF NOT EXISTS scout_candidati_stato_idx ON scout_candidati (linea, stato);
CREATE INDEX IF NOT EXISTS scout_candidati_dominio_idx ON scout_candidati (dominio);
CREATE TABLE IF NOT EXISTS scout_persone (
  id            SERIAL PRIMARY KEY,
  candidato_id  INT NOT NULL REFERENCES scout_candidati(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  titolo        TEXT,                                  -- come scritto sul sito
  ruolo         TEXT,                                  -- ruolo normalizzato (DIRETTORE_SANITARIO, DIREZIONE, ...)
  rango         INT NOT NULL DEFAULT 50,               -- più basso = più vicino alla decisione
  email         TEXT,
  email_stato   TEXT CHECK (email_stato IN ('PUBBLICATA','IPOTESI')),
  telefono      TEXT,
  evidenza      TEXT,                                  -- frase del sito da cui è stata letta
  url           TEXT,                                  -- pagina di provenienza
  contatto_id   INT REFERENCES contatti(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (candidato_id, nome)
);
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sito_web TEXT;
