-- v0.67.1 (richieste del CEO dopo il primo completo Synclab): fonte Synclab per la produzione e per la correlazione esami → materiali.
-- Idempotente e non distruttiva.
--  - exam_mappings.source: MANUALE (inserita a mano o importata: le righe esistenti), LISTINO (precaricata dal listino), SYNCLAB
--    (proposta dai contenitori osservati nel gestionale). "Proponi correlazioni da Synclab" non tocca mai le righe non SYNCLAB.
--  - contenitori_synclab: coppie (materiale, contenitore) dei campioni del gestionale (synclab.samples) con il numero di osservazioni e
--    l'articolo del catalogo abbinato a mano (es. PROVETTA/SIERO → Tappo Giallo).
ALTER TABLE exam_mappings ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'MANUALE';
ALTER TABLE exam_mappings DROP CONSTRAINT IF EXISTS exam_mappings_source_check;
ALTER TABLE exam_mappings ADD CONSTRAINT exam_mappings_source_check CHECK (source IN ('MANUALE','LISTINO','SYNCLAB'));
ALTER TABLE exam_mappings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS contenitori_synclab (
  id            SERIAL PRIMARY KEY,
  material      TEXT NOT NULL DEFAULT '',
  container     TEXT NOT NULL DEFAULT '',
  articolo_id   INT REFERENCES articles(id) ON DELETE SET NULL,
  osservazioni  INT NOT NULL DEFAULT 0,
  aggiornato_il TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (material, container)
);
