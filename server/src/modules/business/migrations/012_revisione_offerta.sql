-- Business Hub · revisione del listino/offerta (richiesta del CEO del 07/11/2026): "nel listino/offerta devi prevedere una sezione di
-- revisione listino/offerta in cui può cambiare anche solo un prezzo e noi rigeneriamo a quel punto solo il PDF del listino/offerta e
-- mandiamo rifirmato solo quello". Una revisione è una nuova versione del listino (stesse righe, prezzi cambiati in pagina) con
-- origine REVISIONE; l'invio per la firma e l'offerta firmata che torna restano sulla versione. Docs: docs/BUSINESS_HUB.md, "Listino:
-- revisione".

-- origine della versione: EXCEL = caricamento del file di StudioLAB (anche dal contratto), REVISIONE = prezzi cambiati in pagina
ALTER TABLE listini ADD COLUMN IF NOT EXISTS origine TEXT NOT NULL DEFAULT 'EXCEL';
ALTER TABLE listini DROP CONSTRAINT IF EXISTS listini_origine_check;
ALTER TABLE listini ADD CONSTRAINT listini_origine_check CHECK (origine IN ('EXCEL', 'REVISIONE'));
ALTER TABLE listini ADD COLUMN IF NOT EXISTS base_listino_id INT REFERENCES listini(id) ON DELETE SET NULL;      -- versione di partenza
-- invio dell'offerta per la firma (EMAIL_OUT sottotipo OFFERTA_REVISIONE) e offerta firmata ricevuta
ALTER TABLE listini ADD COLUMN IF NOT EXISTS revisione_inviata_at TIMESTAMPTZ;
ALTER TABLE listini ADD COLUMN IF NOT EXISTS revisione_activity_id INT REFERENCES activities(id) ON DELETE SET NULL;
ALTER TABLE listini ADD COLUMN IF NOT EXISTS firmata_at TIMESTAMPTZ;
ALTER TABLE listini ADD COLUMN IF NOT EXISTS firmata_documento_id INT REFERENCES documenti(id) ON DELETE SET NULL;
ALTER TABLE listini ADD COLUMN IF NOT EXISTS firmata_by INT REFERENCES users(id);
