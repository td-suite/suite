-- Intorno: cosa c'è intorno a ogni sede (richiesta del CEO del 07/11/2026, docs/RETAIL_INTORNO.md). Rilevazioni con Google Places API
-- (New): una riga per rilevazione (di una sede o di un indirizzo valutato, senza sede) e una riga per luogo trovato, con lo storico
-- (prima e ultima volta visto, chiusura) e il confronto con la rilevazione precedente dello stesso punto (stessa "chiave").

CREATE TABLE IF NOT EXISTS intorno_rilevazioni (
  id                BIGSERIAL PRIMARY KEY,
  site_id           INT REFERENCES public.sites(id) ON DELETE CASCADE,   -- NULL per un indirizzo valutato
  chiave            TEXT NOT NULL,             -- lega lo storico: 'sede:<id>' oppure 'indirizzo:<testo normalizzato>' / 'coord:<lat>,<lng>'
  etichetta         TEXT,                      -- nome della sede o indirizzo trovato dalla geocodifica
  indirizzo         TEXT,                      -- indirizzo come scritto o come trovato (indirizzi valutati)
  lat               DOUBLE PRECISION NOT NULL,
  lng               DOUBLE PRECISION NOT NULL,
  raggio_m          INT NOT NULL,
  data              DATE NOT NULL,             -- giorno della rilevazione (Europe/Rome)
  eseguita_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  categorie         TEXT[] NOT NULL DEFAULT '{}',   -- sottocategorie richieste (laboratorio, farmacia, …)
  sottocategorie_ok TEXT[] NOT NULL DEFAULT '{}',   -- sottocategorie lette senza errori (il confronto considera solo queste)
  n_chiamate        INT NOT NULL DEFAULT 0,          -- chiamate a Google conteggiate nel tetto giornaliero
  stato             TEXT NOT NULL DEFAULT 'IN_CORSO' CHECK (stato IN ('IN_CORSO', 'COMPLETATA', 'PARZIALE', 'INTERROTTA', 'ERRORE')),
  origine           TEXT NOT NULL DEFAULT 'MANUALE' CHECK (origine IN ('MANUALE', 'JOB', 'VALUTAZIONE')),
  prova             BOOLEAN NOT NULL DEFAULT FALSE,  -- risposte finte (INTORNO_MOCK=1): mai dati reali
  errori            JSONB,                     -- errori per sottocategoria o motivo dell'interruzione
  geocodifica       JSONB,                     -- indirizzo trovato, precisione, place_id (indirizzi valutati)
  sintesi           JSONB,                     -- contatori per categoria e sottocategoria (entro 500 m, 1 km, raggio)
  punteggio         JSONB,                     -- attrattività con le componenti (mai il numero da solo)
  confronto         JSONB,                     -- nuovi, scomparsi, cambiati rispetto alla rilevazione precedente
  precedente_id     BIGINT REFERENCES intorno_rilevazioni(id) ON DELETE SET NULL,
  creata_da         INT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS intorno_rilevazioni_chiave_idx ON intorno_rilevazioni (chiave, eseguita_at DESC);
CREATE INDEX IF NOT EXISTS intorno_rilevazioni_site_idx ON intorno_rilevazioni (site_id, eseguita_at DESC);
CREATE INDEX IF NOT EXISTS intorno_rilevazioni_precedente_idx ON intorno_rilevazioni (precedente_id);
CREATE INDEX IF NOT EXISTS intorno_rilevazioni_creata_da_idx ON intorno_rilevazioni (creata_da);

CREATE TABLE IF NOT EXISTS intorno_luoghi (
  id              BIGSERIAL PRIMARY KEY,
  rilevazione_id  BIGINT NOT NULL REFERENCES intorno_rilevazioni(id) ON DELETE CASCADE,
  place_id        TEXT NOT NULL,               -- id del luogo in Google Places
  categoria       TEXT NOT NULL CHECK (categoria IN ('CONCORRENTE', 'PRESCRITTORE', 'ATTRATTORE', 'CONTESTO')),
  sottocategoria  TEXT NOT NULL,               -- laboratorio, centro_diagnostico, radiologia, … (lib/intorno.js)
  nome            TEXT NOT NULL,
  indirizzo       TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  distanza_m      INT,
  tipi            TEXT[] NOT NULL DEFAULT '{}',
  tipo_principale TEXT,
  rating          NUMERIC(2,1),
  n_recensioni    INT,
  orari           JSONB,                       -- regularOpeningHours: weekdayDescriptions e periods
  sito            TEXT,
  telefono        TEXT,
  stato_attivita  TEXT,                        -- businessStatus: OPERATIONAL, CLOSED_TEMPORARILY, CLOSED_PERMANENTLY
  presente        BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = scomparso rispetto alla rilevazione precedente (riga ricopiata)
  novita          TEXT CHECK (novita IN ('NUOVO', 'SCOMPARSO', 'CAMBIATO')),
  cambiamenti     JSONB,                       -- campi cambiati: [{campo, prima, dopo}]
  prima_vista     DATE NOT NULL,
  ultima_vista    DATE NOT NULL,
  chiuso_at       DATE,                        -- scomparso o chiuso definitivamente da questa data
  UNIQUE (rilevazione_id, place_id)
);
CREATE INDEX IF NOT EXISTS intorno_luoghi_place_idx ON intorno_luoghi (place_id);

-- Contatore delle chiamate a Google per giorno (Europe/Rome): il tetto giornaliero è l'impostazione retail.intorno.tetto_giornaliero
CREATE TABLE IF NOT EXISTS intorno_chiamate (
  giorno         DATE PRIMARY KEY,
  n              INT NOT NULL DEFAULT 0,
  aggiornato_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
