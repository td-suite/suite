-- Scadenziario strutture: documenti dei contratti di affitto (richiesta del CEO, 28/10/2026: caricamento del contratto in PDF e lettura
-- con l'API Anthropic di locatore, sede, importi e durata, con precompilazione del form). Archivio a due vie come Business
-- (server/src/lib/moduleStorage.js): bytea nel database oppure percorso nel blob della Suite. `extracted` conserva il JSON letto da
-- Claude (dati del contratto: nessun dato di paziente), `lease_id` resta vuoto finché il contratto non viene creato dal form.
CREATE TABLE IF NOT EXISTS lease_documents (
  id            SERIAL PRIMARY KEY,
  lease_id      INT REFERENCES lease_contracts(id) ON DELETE CASCADE,
  filename      TEXT NOT NULL,
  mime          TEXT NOT NULL DEFAULT 'application/pdf',
  size          INT NOT NULL,
  sha256        TEXT NOT NULL,
  data          BYTEA,
  blob_path     TEXT,
  extracted     JSONB,                                   -- dati letti dal contratto (locatore, immobile, durata, canone, ...)
  extracted_at  TIMESTAMPTZ,
  model         TEXT,                                    -- modello usato (o "mock" in collaudo)
  text_chars    INT,                                     -- caratteri di testo estratti (per diagnosi)
  ocr           BOOLEAN NOT NULL DEFAULT FALSE,          -- il PDF era una scansione letta con OCR
  uploaded_by   INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lease_documents_lease_idx ON lease_documents (lease_id);
