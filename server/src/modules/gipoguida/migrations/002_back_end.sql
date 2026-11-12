-- Guida GIPO v0.71.1 (brief "risposte all'altezza del back-end"): fonte e livello delle sezioni, sintesi per l'indice di pianificazione,
-- validazione che arriva dal seme (manuale operativo TD-SGI-MAN007), indice di ricerca esteso (titolo, parole chiave, capitolo, sintesi,
-- domande delle FAQ collegate, testo) con pesi A/B/C/D, esito PARZIALE e "Rigenera risposta" / "Segna come risolta dalla guida" nella coda.
-- Migrazione idempotente: IF NOT EXISTS, DROP ... IF EXISTS prima di ogni ADD CONSTRAINT, CREATE OR REPLACE per funzioni e trigger.

-- ---------------------------------------------------------------- sezioni: fonte, livello, sintesi, validazione dal seme
ALTER TABLE sezioni ADD COLUMN IF NOT EXISTS fonte TEXT NOT NULL DEFAULT 'INTERFACCIA';
ALTER TABLE sezioni ADD COLUMN IF NOT EXISTS livello TEXT NOT NULL DEFAULT 'OPERATIVO';
ALTER TABLE sezioni ADD COLUMN IF NOT EXISTS sintesi TEXT;
ALTER TABLE sezioni ADD COLUMN IF NOT EXISTS fonte_validazione TEXT;   -- es. "Manuale operativo TD-SGI-MAN007" (validazione dal seme)
ALTER TABLE sezioni ADD COLUMN IF NOT EXISTS seme_meta_hash TEXT;      -- impronta di fonte, livello e sintesi caricati dal seme
ALTER TABLE sezioni ADD COLUMN IF NOT EXISTS ricerca_tsv tsvector;     -- indice esteso, mantenuto dai trigger qui sotto
ALTER TABLE sezioni DROP CONSTRAINT IF EXISTS sezioni_fonte_check;
ALTER TABLE sezioni ADD CONSTRAINT sezioni_fonte_check CHECK (fonte IN ('INTERFACCIA', 'MANUALE_TD', 'INTERFACCIA+MANUALE', 'REDAZIONE'));
ALTER TABLE sezioni DROP CONSTRAINT IF EXISTS sezioni_livello_check;
ALTER TABLE sezioni ADD CONSTRAINT sezioni_livello_check CHECK (livello IN ('OPERATIVO', 'BACK_END'));
UPDATE sezioni SET fonte = 'REDAZIONE' WHERE origine = 'REDAZIONE' AND fonte = 'INTERFACCIA';
CREATE INDEX IF NOT EXISTS sezioni_livello ON sezioni (livello);

-- ---------------------------------------------------------------- indice di ricerca esteso
-- A: titolo e parole chiave · B: sintesi, titolo del capitolo, domande delle FAQ pubblicate collegate · C: testo · D: percorso in GIPO.
-- La funzione fissa il search_path dello schema del modulo (le scritture possono arrivare anche da connessioni con search_path diverso).
CREATE OR REPLACE FUNCTION gg_tsv_sezione(p_titolo TEXT, p_parole TEXT, p_sintesi TEXT, p_capitolo INT, p_id INT, p_corpo TEXT, p_percorso TEXT)
RETURNS tsvector LANGUAGE sql STABLE SET search_path FROM CURRENT AS $$
  SELECT setweight(to_tsvector('italian'::regconfig, coalesce(p_titolo, '')), 'A') ||
         setweight(to_tsvector('italian'::regconfig, coalesce(p_parole, '')), 'A') ||
         setweight(to_tsvector('italian'::regconfig, coalesce(p_sintesi, '')), 'B') ||
         setweight(to_tsvector('italian'::regconfig, coalesce((SELECT k.titolo FROM capitoli k WHERE k.numero = p_capitolo), '')), 'B') ||
         setweight(to_tsvector('italian'::regconfig, coalesce((SELECT string_agg(f.domanda, ' . ') FROM faq f WHERE f.sezione_id = p_id AND f.pubblicata), '')), 'B') ||
         setweight(to_tsvector('italian'::regconfig, coalesce(p_corpo, '')), 'C') ||
         setweight(to_tsvector('italian'::regconfig, coalesce(p_percorso, '')), 'D')
$$;

CREATE OR REPLACE FUNCTION gg_sezioni_tsv() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  NEW.ricerca_tsv := gg_tsv_sezione(NEW.titolo, NEW.parole_chiave, NEW.sintesi, NEW.capitolo, NEW.id, NEW.corpo, NEW.percorso_gipo);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sezioni_ricerca_tsv ON sezioni;
CREATE TRIGGER sezioni_ricerca_tsv BEFORE INSERT OR UPDATE ON sezioni FOR EACH ROW EXECUTE FUNCTION gg_sezioni_tsv();

-- una FAQ nuova, modificata, spostata o tolta dalla pubblicazione ricalcola l'indice delle sezioni interessate
CREATE OR REPLACE FUNCTION gg_faq_tsv() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.sezione_id IS NOT NULL THEN UPDATE sezioni SET ricerca_tsv = NULL WHERE id = OLD.sezione_id; END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.sezione_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.sezione_id IS DISTINCT FROM OLD.sezione_id
      OR NEW.domanda IS DISTINCT FROM OLD.domanda OR NEW.pubblicata IS DISTINCT FROM OLD.pubblicata) THEN
    UPDATE sezioni SET ricerca_tsv = NULL WHERE id = NEW.sezione_id;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS faq_ricerca_tsv ON faq;
CREATE TRIGGER faq_ricerca_tsv AFTER INSERT OR UPDATE OR DELETE ON faq FOR EACH ROW EXECUTE FUNCTION gg_faq_tsv();

-- il titolo di un capitolo entra nell'indice delle sue sezioni
CREATE OR REPLACE FUNCTION gg_capitoli_tsv() RETURNS trigger LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
BEGIN
  IF NEW.titolo IS DISTINCT FROM OLD.titolo THEN UPDATE sezioni SET ricerca_tsv = NULL WHERE capitolo = NEW.numero; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS capitoli_ricerca_tsv ON capitoli;
CREATE TRIGGER capitoli_ricerca_tsv AFTER UPDATE ON capitoli FOR EACH ROW EXECUTE FUNCTION gg_capitoli_tsv();

UPDATE sezioni SET ricerca_tsv = NULL;   -- calcolo iniziale (il trigger BEFORE UPDATE lo riempie)
CREATE INDEX IF NOT EXISTS sezioni_ricerca_tsv ON sezioni USING GIN (ricerca_tsv);
-- ripiego per trigrammi (pg_trgm) su titolo e parole chiave, quando il full text non trova nulla (errori di battitura, parole tronche)
CREATE INDEX IF NOT EXISTS sezioni_trgm ON sezioni USING GIN ((lower(titolo || ' ' || coalesce(parole_chiave, ''))) gin_trgm_ops);

-- ---------------------------------------------------------------- domande: esito PARZIALE, rigenerazione, risolta dalla guida
ALTER TABLE domande DROP CONSTRAINT IF EXISTS domande_esito_check;
ALTER TABLE domande ADD CONSTRAINT domande_esito_check CHECK (esito IN ('RISPOSTA', 'PARZIALE', 'SENZA_RISPOSTA', 'SOLO_RICERCA'));
ALTER TABLE domande ADD COLUMN IF NOT EXISTS rigenerata_il TIMESTAMPTZ;
ALTER TABLE domande ADD COLUMN IF NOT EXISTS rigenerata_da INT REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE domande ADD COLUMN IF NOT EXISTS rigenerazioni INT NOT NULL DEFAULT 0;
ALTER TABLE domande ADD COLUMN IF NOT EXISTS risolta_dalla_guida BOOLEAN NOT NULL DEFAULT FALSE;
