-- v0.72.0 (richieste del CEO del 13/11/2026, prima della consegna): approvazione automatica della nota del vertice dell'organigramma e
-- invio del PDF di approvazione ai destinatari configurati (consulente del lavoro, esterni all'azienda) dalla casella people@.
-- Esito dell'ultimo invio sulla nota (lo storico completo è negli eventi PDF_APPROVAZIONE e nel registro email della Suite). Idempotente.
ALTER TABLE note ADD COLUMN IF NOT EXISTS approvazione_automatica BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE note ADD COLUMN IF NOT EXISTS email_approvazione_esito TEXT CHECK (email_approvazione_esito IS NULL OR email_approvazione_esito IN ('INVIATA','ERRORE','SALTATA'));
ALTER TABLE note ADD COLUMN IF NOT EXISTS email_approvazione_errore TEXT;
ALTER TABLE note ADD COLUMN IF NOT EXISTS email_approvazione_at TIMESTAMPTZ;
