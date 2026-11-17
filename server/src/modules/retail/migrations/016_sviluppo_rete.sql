-- Retail Assistant · Sviluppo rete (richiesta del CEO del 17/11/2026, docs/RETAIL_SVILUPPO_RETE.md): posizionamento rispetto ai
-- concorrenti, valutazione di un indirizzo con stima di resa, comuni della Toscana dove aprire. Idempotente, non distruttiva.

-- Comuni della Toscana (semina da assets/comuni-toscana.json alla prima lettura: codice ISTAT, coordinate, residenti 2021)
CREATE TABLE IF NOT EXISTS rete_comuni (
  istat           TEXT PRIMARY KEY,
  nome            TEXT NOT NULL,
  provincia       TEXT NOT NULL,
  cap             TEXT,
  lat             DOUBLE PRECISION NOT NULL,
  lng             DOUBLE PRECISION NOT NULL,
  coord_fonte     TEXT NOT NULL DEFAULT 'CENTROIDE' CHECK (coord_fonte IN ('CENTROIDE', 'GOOGLE', 'MANUALE')),   -- CENTROIDE: baricentro del territorio, può cadere fuori dal centro abitato
  popolazione     INT,
  popolazione_anno INT,
  over65          INT,                          -- residenti con 65 anni o più (vuoto finché non lo si carica)
  rilevazione_id  BIGINT REFERENCES intorno_rilevazioni(id) ON DELETE SET NULL,
  rilevato_at     TIMESTAMPTZ,
  errore          TEXT,
  escluso         BOOLEAN NOT NULL DEFAULT FALSE,   -- tolto dalla classifica da una persona (con nota)
  nota            TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- La scheda Google della sede TD (per non contarla tra i concorrenti e per confrontarne rating e recensioni)
CREATE TABLE IF NOT EXISTS rete_sedi_google (
  site_id     INT PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  place_id    TEXT NOT NULL,
  nome        TEXT,
  impostata_da INT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Prezzi dei concorrenti rilevati a mano (Google non li fornisce): una riga per concorrente, prestazione e data
CREATE TABLE IF NOT EXISTS rete_prezzi (
  id            BIGSERIAL PRIMARY KEY,
  site_id       INT REFERENCES public.sites(id) ON DELETE CASCADE,   -- sede TD a cui si riferisce il confronto
  place_id      TEXT,                          -- luogo Google del concorrente, se scelto dall'elenco
  concorrente   TEXT NOT NULL,
  prestazione   TEXT NOT NULL,
  prezzo        NUMERIC(10,2) NOT NULL,
  prezzo_td     NUMERIC(10,2),                 -- prezzo TD della stessa prestazione alla data della rilevazione
  rilevato_il   DATE NOT NULL,
  fonte         TEXT,                          -- dove è stato letto: sito, telefono, volantino
  nota          TEXT,
  creato_da     INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rete_prezzi_site_idx ON rete_prezzi (site_id, rilevato_il DESC);

-- Centri commerciali tra le categorie dell'Intorno: se l'elenco delle categorie attive è stato salvato, si aggiunge la nuova
UPDATE app_settings SET value = value || ',centro_commerciale'
 WHERE key = 'retail.intorno.sottocategorie' AND value <> '' AND position('centro_commerciale' in value) = 0;
