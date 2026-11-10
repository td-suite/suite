-- v0.68.4 parte A (richieste del CEO del 10/11/2026): nella correlazione esami → materiali la chiave è il TESTO DELL'ETICHETTA preso dal
-- gestionale, non il materiale biologico. Idempotente e non distruttiva.
--  - exam_catalog.label_text: testo delle etichette dell'esame letto da ServiceNET (/api/esami con IncludiEtichette, Etichette[]); più
--    etichette separate da " | ". Seconda fonte, dopo synclab.samples.container.
--  - etichette_synclab: una riga per testo di etichetta distinto (chiave = testo senza spazi doppi, in maiuscolo), con l'articolo di
--    magazzino abbinato, i campioni osservati e il materiale biologico solo come informazione secondaria (mai chiave).
--  - Rifusione di contenitori_synclab (una riga per coppia materiale/contenitore, migrazione 014): le coppie con lo stesso contenitore
--    diventano una sola etichetta; l'articolo è quello della coppia abbinata più osservata e, se le coppie avevano articoli diversi, la
--    riga porta la segnalazione in nota_rifusione. contenitori_synclab resta (storico, non più aggiornata).
ALTER TABLE exam_catalog ADD COLUMN IF NOT EXISTS label_text TEXT;

CREATE TABLE IF NOT EXISTS etichette_synclab (
  id             SERIAL PRIMARY KEY,
  chiave         TEXT NOT NULL UNIQUE,              -- upper(testo) con spazi singoli; '' = etichetta non indicata nel gestionale
  etichetta      TEXT NOT NULL DEFAULT '',          -- testo come scritto nel gestionale (la forma più frequente)
  articolo_id    INT REFERENCES articles(id) ON DELETE SET NULL,
  campioni       INT NOT NULL DEFAULT 0,            -- campioni delle accettazioni attive con questa etichetta
  materiali      TEXT,                              -- informazione secondaria: materiali biologici visti (es. "SIERO 120, PLASMA 3")
  fonte          TEXT NOT NULL DEFAULT 'CAMPIONI' CHECK (fonte IN ('CAMPIONI','SERVICENET')),
  nota_rifusione TEXT,                              -- segnalazione della migrazione 017 (articoli diversi sulla stessa etichetta)
  aggiornato_il  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS etichette_synclab_articolo_idx ON etichette_synclab (articolo_id) WHERE articolo_id IS NOT NULL;

-- Rifusione per etichetta (solo le etichette non ancora presenti: rieseguita non cambia nulla)
WITH c AS (
  SELECT upper(regexp_replace(btrim(container), '\s+', ' ', 'g')) AS chiave, regexp_replace(btrim(container), '\s+', ' ', 'g') AS testo,
         material, articolo_id, osservazioni
    FROM contenitori_synclab
),
g AS (
  SELECT chiave,
         (SELECT x.testo FROM c x WHERE x.chiave = c.chiave GROUP BY x.testo ORDER BY sum(x.osservazioni) DESC, x.testo LIMIT 1) AS etichetta,
         sum(osservazioni)::int AS campioni,
         string_agg(CASE WHEN material <> '' THEN material || ' ' || osservazioni END, ', ' ORDER BY osservazioni DESC, material) AS materiali
    FROM c GROUP BY chiave
),
art AS (   -- articoli abbinati per etichetta, con le osservazioni delle coppie che li portavano
  SELECT c.chiave, c.articolo_id, sum(c.osservazioni)::int AS oss, a.name
    FROM c JOIN articles a ON a.id = c.articolo_id GROUP BY c.chiave, c.articolo_id, a.name
),
scelta AS (
  SELECT DISTINCT ON (chiave) chiave, articolo_id FROM art ORDER BY chiave, oss DESC, articolo_id
),
nota AS (
  SELECT chiave, 'Rifusione 0.68.4: le coppie materiale/contenitore con questa etichetta avevano articoli diversi ('
         || string_agg(name || ' ' || oss || ' campioni', ', ' ORDER BY oss DESC, articolo_id) || '): tenuto il più osservato, da verificare' AS testo
    FROM art GROUP BY chiave HAVING count(*) > 1
)
INSERT INTO etichette_synclab (chiave, etichetta, articolo_id, campioni, materiali, fonte, nota_rifusione)
SELECT g.chiave, g.etichetta, s.articolo_id, g.campioni, g.materiali, 'CAMPIONI', n.testo
  FROM g LEFT JOIN scelta s ON s.chiave = g.chiave LEFT JOIN nota n ON n.chiave = g.chiave
ON CONFLICT (chiave) DO NOTHING;
