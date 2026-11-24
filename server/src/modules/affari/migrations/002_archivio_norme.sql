-- Public Affairs v0.97.0 (CEO, 24/11/2026): archivio di avvisi e bandi pubblicati dal gennaio 2026; normativa di riferimento su
-- autorizzazione e accreditamento con ricerca in linguaggio naturale. Idempotente, non distruttiva.
ALTER TABLE voci ADD COLUMN IF NOT EXISTS storica BOOLEAN NOT NULL DEFAULT FALSE;   -- raccolta ricostruendo l'archivio (anche dalle pagine successive dell'elenco)
CREATE INDEX IF NOT EXISTS voci_archivio_idx ON voci (fonte_id, pubblicata DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS norme (
  id           SERIAL PRIMARY KEY,
  chiave       TEXT UNIQUE,                 -- norme proposte dalla Suite (testo nel programma); NULL per quelle aggiunte dalla Direzione
  titolo       TEXT NOT NULL,
  descrizione  TEXT,
  url          TEXT,                        -- testo ufficiale
  url_pdf      TEXT,
  ordine       INT NOT NULL DEFAULT 100,
  testo        TEXT,                        -- testo acquisito (NULL = solo collegamento)
  caratteri    INT,
  fonte_testo  TEXT,                        -- da dove e quando è stato preso il testo
  acquisita_at TIMESTAMPTZ,
  errore       TEXT,
  seme         BOOLEAN NOT NULL DEFAULT FALSE,
  created_by   INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS norme_parti (
  id       BIGSERIAL PRIMARY KEY,
  norma_id INT NOT NULL REFERENCES norme(id) ON DELETE CASCADE,
  n        INT NOT NULL,
  rif      TEXT,                            -- allegato, sezione, articolo o requisito a cui appartiene il brano
  testo    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS norme_parti_norma ON norme_parti (norma_id, n);
CREATE TABLE IF NOT EXISTS norme_domande (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     INT,
  domanda     TEXT NOT NULL,
  risposta    TEXT,
  esito       TEXT,                         -- COMPLETA | PARZIALE | NON_TROVATA | ERRORE
  riferimenti JSONB NOT NULL DEFAULT '[]'
);
