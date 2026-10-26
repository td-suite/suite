-- Connettori unici verso i sistemi esterni (decisione del CEO, 26/10/2026): un connettore per sistema, configurato una volta
-- in Amministrazione > Connettori e valido per tutta la Suite. I moduli (Non conformità, Ordini, Retail) leggono base URL,
-- credenziali e segreto in ingresso da qui tramite lib/connectors.js; le variabili d'ambiente dei moduli restano come ripiego
-- finché la riga non è configurata. credentials e inbound_secret sono cifrati con lib/secrets.js (AES-256-GCM, CREDENTIALS_KEY).
CREATE TABLE connectors (
  kind           TEXT PRIMARY KEY CHECK (kind IN ('STUDIOLAB','GIPO','TUOTEMPO','SILVA')),
  name           TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT FALSE,
  base_url       TEXT,
  auth_kind      TEXT NOT NULL DEFAULT 'API_KEY' CHECK (auth_kind IN ('API_KEY','BASIC','OAUTH2','NONE')),
  credentials    TEXT,                                   -- JSON cifrato: {api_key} | {user,password} | {client_id,client_secret}
  inbound_secret TEXT,                                   -- cifrato: il segreto che il sistema esterno usa per chiamare la Suite
  settings       JSONB NOT NULL DEFAULT '{}'::jsonb,     -- client_code, instance, lang, timeout_ms, ip_allowlist [], customer_code, order_email...
  schedule       TEXT NOT NULL DEFAULT 'MANUALE',        -- MANUALE | HOURLY | DAILY (usato dalle sincronizzazioni dei moduli)
  last_test_at   TIMESTAMPTZ,
  last_status    TEXT,                                   -- OK | ERRORE
  last_message   TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by     INT REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO connectors (kind, name, base_url, auth_kind, settings) VALUES
  ('STUDIOLAB', 'StudioLAB ServiceNET (CB Sistemi)', 'https://servicenet.toscanadiagnostica.it/API', 'API_KEY', '{"client_code":"TD","timeout_ms":12000}'),
  ('GIPO',      'GIPO (Docplanner)',                   NULL,                                            'API_KEY', '{}'),
  ('TUOTEMPO',  'TuoTempo (Docplanner)',               'https://app.tuotempo.com/api/v3',               'API_KEY', '{"lang":"it"}'),
  ('SILVA',     'Silva Group (magazzino)',             NULL,                                            'NONE',    '{"customer_code":"TOSCANA-DIAGNOSTICA"}');

-- Registro delle chiamate: IN = il sistema esterno chiama la Suite, OUT = la Suite chiama il sistema esterno
CREATE TABLE connector_log (
  id        BIGSERIAL PRIMARY KEY,
  kind      TEXT NOT NULL REFERENCES connectors(kind) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
  module    TEXT,                                        -- modulo della Suite che ha fatto o ricevuto la chiamata
  endpoint  TEXT,
  status    TEXT,                                        -- OK | ERRORE | codice HTTP
  ms        INT,
  message   TEXT,
  at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX connector_log_kind_at ON connector_log (kind, at DESC);
