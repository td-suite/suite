-- Circolari da Comunicazione (CEO, 08/11/2026: "una circolare costruita dal widget Comunicazione deve figurare in Archivio"). Una sola
-- serie TD-AAAA/NNN: la circolare pubblicata in Comunicazione viene protocollata e impaginata qui, con l'origine e il legame con la news.
-- news_id: chiave esterna LOGICA verso public.news(id); stessa news, più revisioni (TD-AAAA/NNN-rN) → unicità su (news_id, revisione).
-- allegati: allegati della news agganciati alla circolare [{ id, filename, mime, size }] (file della Suite, /api/files/:id).
-- invii.news_id / invii.segmento: la diffusione della circolare da Comunicazione (notifica ed email di avviso della news) registrata
-- come invio al segmento PERSONALE, con gli esiti letti dal registro email della Suite (ref news:<id>): nessun secondo invio.
-- Idempotente e non distruttiva.
ALTER TABLE circolari ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'CIRCOLARI';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'circolari_origine_chk' AND conrelid = 'circolari.circolari'::regclass) THEN
    ALTER TABLE circolari ADD CONSTRAINT circolari_origine_chk CHECK (origine IN ('CIRCOLARI','COMUNICAZIONE'));
  END IF;
END $$;
ALTER TABLE circolari ADD COLUMN IF NOT EXISTS news_id INT;
ALTER TABLE circolari ADD COLUMN IF NOT EXISTS allegati JSONB NOT NULL DEFAULT '[]';
CREATE UNIQUE INDEX IF NOT EXISTS circolari_news_rev ON circolari (news_id, revisione) WHERE news_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS circolari_origine ON circolari (origine);

ALTER TABLE invii ADD COLUMN IF NOT EXISTS news_id INT;
ALTER TABLE invii ADD COLUMN IF NOT EXISTS segmento TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS invii_news ON invii (news_id) WHERE news_id IS NOT NULL;
