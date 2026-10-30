-- Richiesta del CEO (30/10/2026): nella sezione Lifestyle le richieste arrivano anche come PDF o email caricati in "Richieste in
-- arrivo" (lettura assistita con Claude) e il richiedente del kit può essere una Legal entity (public.organizations).

-- ---- Richiedente della richiesta ----
-- PERSONA: il richiedente è il destinatario stesso (campi patient_*, come finora).
-- LEGAL_ENTITY: azienda cliente, medico/struttura o partner che ordina il kit; fattura e comunicazioni vanno al richiedente
-- (requester_org_id + referente/email/telefono), mentre patient_* e indirizzo restano il destinatario del kit (chi lo riceve).
-- Kit ordinati senza paziente nominato: patient_last_name = ragione sociale (o reparto/destinatario) e patient_first_name = ''
-- (stringa vuota, non NULL: tutte le liste, le etichette e i PDF concatenano nome e cognome e restano corretti senza modifiche).
-- La coerenza "LEGAL_ENTITY ⇒ requester_org_id valorizzato" è verificata dall'applicazione (routes/orders.js): un vincolo CHECK
-- impedirebbe la cancellazione della Legal entity (ON DELETE SET NULL).
ALTER TABLE orders ADD COLUMN IF NOT EXISTS requester_kind TEXT NOT NULL DEFAULT 'PERSONA';
ALTER TABLE orders ADD CONSTRAINT orders_requester_kind_check CHECK (requester_kind IN ('PERSONA','LEGAL_ENTITY'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS requester_org_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS requester_contact TEXT;   -- referente presso la Legal entity
ALTER TABLE orders ADD COLUMN IF NOT EXISTS requester_email TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS requester_phone TEXT;
CREATE INDEX IF NOT EXISTS orders_requester_org_idx ON orders (requester_org_id) WHERE requester_org_id IS NOT NULL;
-- origine della richiesta: anche da documento caricato (PDF o .eml) in "Richieste in arrivo"
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check CHECK (source IN ('MANUAL','EMAIL','UPLOAD'));

-- ---- Messaggi in arrivo: documenti caricati ----
-- source esiste già (GRAPH = casella shipments@, PASTE = email incollata): si aggiunge UPLOAD (file caricato), senza rinominare
-- GRAPH, perché i dati travasati e il lavoro di lettura della casella lo usano.
ALTER TABLE inbox_messages DROP CONSTRAINT IF EXISTS inbox_messages_source_check;
ALTER TABLE inbox_messages ADD CONSTRAINT inbox_messages_source_check CHECK (source IN ('GRAPH','PASTE','UPLOAD'));
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS project TEXT NOT NULL DEFAULT 'ENDEAVOR';
ALTER TABLE inbox_messages ADD CONSTRAINT inbox_messages_project_check CHECK (project IN ('ENDEAVOR','LIFESTYLE'));
-- file caricato, archivio a due vie (lib/moduleStorage.js: blob della Suite se configurato, altrimenti bytea)
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS filename TEXT;
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS mime TEXT;
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS size INT;
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS sha256 TEXT;
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS data BYTEA;
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS blob_path TEXT;
-- lettura assistita (Lifestyle): JSON restituito da Claude (o dall'estrattore di prova), modello, OCR, avvisi per l'operatore e
-- Legal entity proposta come richiedente ({ id, name, how } oppure null)
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS extracted JSONB;
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS extracted_model TEXT;
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS ocr BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS avvisi JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE inbox_messages ADD COLUMN IF NOT EXISTS requester_match JSONB;
CREATE INDEX IF NOT EXISTS inbox_project_status_idx ON inbox_messages (project, status, received_at DESC);
CREATE INDEX IF NOT EXISTS inbox_sha256_idx ON inbox_messages (sha256) WHERE sha256 IS NOT NULL;
