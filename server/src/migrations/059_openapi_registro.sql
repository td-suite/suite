-- v0.80.0 · Openapi in tutta la Suite, fase 1 (CEO 17/11/2026): scheda dell'impresa dal registro (API Company, IT-advanced) per compilare e
-- tenere controllate le Legal entity, e dati di CAP, comune e provincia (API Cap). Idempotente e non distruttiva.
-- Cache delle risposte: una scheda già pagata non si richiede due volte entro la sua validità.
CREATE TABLE IF NOT EXISTS openapi_cache (
  chiave    TEXT PRIMARY KEY,              -- 'impresa:<partita IVA o codice fiscale>' | 'cap:<cap>'
  dati      JSONB NOT NULL,
  letto_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Chiamate a pagamento per mese e servizio: è il contatore del tetto di spesa (il registro chiamate dei connettori viene sfoltito)
CREATE TABLE IF NOT EXISTS openapi_uso (
  mese      TEXT NOT NULL,                 -- AAAA-MM
  servizio  TEXT NOT NULL,                 -- 'impresa' | 'cap'
  chiamate  INT NOT NULL DEFAULT 0,
  PRIMARY KEY (mese, servizio)
);
-- Esito dell'ultimo controllo sul registro imprese, sulla Legal entity
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS registry_checked_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS registry_status TEXT;      -- stato attività dal registro (ATTIVA, CESSATA, ...), NON_TROVATA
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS registry_alert TEXT;       -- cosa va guardato: cessata, dati diversi dal registro
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS registry_data JSONB;       -- scheda normalizzata: ATECO, forma giuridica, REA, ultimo bilancio, soci
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS registry_diff JSONB;       -- campi in cui l'anagrafica differisce dal registro
CREATE INDEX IF NOT EXISTS organizations_registry_idx ON organizations (registry_checked_at NULLS FIRST) WHERE vat_number IS NOT NULL OR tax_code IS NOT NULL;
