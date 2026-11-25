-- Ordini v0.98.1 (CEO, 25/11/2026): transcodifica tra i contenitori generici delle correlazioni ("Tappo Viola", "Tappo Giallo"…, nati
-- prima del catalogo Silva e nascosti dalla migrazione 020) e gli articoli di magazzino. Idempotente e non distruttiva: nessuna
-- correlazione viene cambiata qui; cambia solo quando l'Area Operations conferma l'abbinamento nella pagina Correlazioni.
--  - articoli_transcodifica: una riga per contenitore generico confermato, con l'articolo di magazzino e chi ha confermato.
--  - exam_mappings.articolo_origine_id: il contenitore generico da cui la correlazione proviene (per poter annullare la conferma).
CREATE TABLE IF NOT EXISTS articoli_transcodifica (
  da_article_id  INT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  a_article_id   INT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  confermato_il  TIMESTAMPTZ NOT NULL DEFAULT now(),
  confermato_da  INT
);
ALTER TABLE exam_mappings ADD COLUMN IF NOT EXISTS articolo_origine_id INT REFERENCES articles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS exam_mappings_origine_idx ON exam_mappings (articolo_origine_id) WHERE articolo_origine_id IS NOT NULL;
