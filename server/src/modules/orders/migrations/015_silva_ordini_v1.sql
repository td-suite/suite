-- v0.68.2 (09/11/2026): trasmissione a Silva secondo la Guida tecnica API ordini v1 definitiva (docs/silva-api-ordini/).
-- Idempotente e non distruttiva: solo colonne nuove e un indice.
--  - silva_received_at: "ricevutoAl" della ricevuta Silva (201 nuovo ordine o 200 ricevuta originale di un ordine identico).
--  - silva_retry_at: prossimo tentativo consentito (5 minuti dopo un 503/timeout, Retry-After dopo un 429): "in coda, ritenta alle ...".
--  - silva_error_code / silva_error_field: error e campo del 400 di Silva (es. unit_or_code_mismatch, righe[0].unita; immutable_order).
--  - silva_key_fp: impronta (SHA-256 troncato, mai la chiave) della chiave che ha ricevuto 401/403: l'invio non si ripete finché la
--    chiave del connettore non cambia.
--  - silva_problemi: motivi del blocco locale (articolo senza codice Silva, struttura senza destinazione, unità non del catalogo, ...).
--  - silva_stato*: ultimo stato letto con GET /api/v1/ordini/{numero}/stato (IN_PREPARAZIONE, EVASO, ANNULLATO, NON_DISPONIBILE;
--    ASSENTE = 404 dopo una ricevuta), quando è stato letto e da quando vale (prima rilevazione).
-- Valori di silva_send_status: NULL (da trasmettere), BLOCCATO (dati da completare nella Suite), IN_CODA (ritentabile), INVIATO,
-- ERRORE_DATI (400/413/415: non si ritenta), ERRORE_CHIAVE (401/403); ERRORE resta per gli ordini della versione precedente.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_received_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_retry_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_error_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_error_field TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_key_fp TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_problemi JSONB;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_stato TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_stato_at TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_stato_dal TIMESTAMPTZ;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS silva_stato_msg TEXT;
CREATE INDEX IF NOT EXISTS orders_silva_send_idx ON orders (silva_send_status) WHERE status IN ('APPROVATO','PRESO_IN_CARICO','SPEDITO');
