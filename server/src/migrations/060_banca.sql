-- Collegamento bancario (Enable Banking, v0.95.0, CEO 24/11/2026): conti correnti dell'azienda letti in sola lettura (saldi e movimenti)
-- con il consenso del titolare del conto presso la banca. Servono a Recupero Crediti (riconciliazione degli incassi con le fatture,
-- prima di ogni sollecito) e a Finance Management (quadratura con conto economico e pagamenti). Nessuna disposizione di pagamento.
-- Le credenziali dell'applicazione (identificativo e chiave privata) stanno SOLO nelle variabili d'ambiente, mai nel database.
-- Idempotente e non distruttiva.
CREATE TABLE IF NOT EXISTS bank_connections (
  id               SERIAL PRIMARY KEY,
  aspsp_name       TEXT NOT NULL,                 -- banca, come nell'elenco di Enable Banking
  aspsp_country    TEXT NOT NULL DEFAULT 'IT',
  psu_type         TEXT NOT NULL DEFAULT 'business',
  state            TEXT NOT NULL UNIQUE,          -- valore casuale del giro di autorizzazione (anti-CSRF del ritorno)
  authorization_id TEXT,
  session_id       TEXT,                          -- sessione autorizzata: con questa si leggono conti e movimenti
  valid_until      TIMESTAMPTZ,                   -- fine del consenso: poi serve una nuova autorizzazione in banca
  status           TEXT NOT NULL DEFAULT 'IN_ATTESA' CHECK (status IN ('IN_ATTESA','ATTIVA','SCADUTA','REVOCATA','ERRORE')),
  last_error       TEXT,
  avviso_scadenza_at TIMESTAMPTZ,                 -- ultimo avviso "consenso in scadenza" inviato
  created_by       INT REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  authorized_at    TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bank_accounts (
  id             SERIAL PRIMARY KEY,
  connection_id  INT NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
  uid            TEXT NOT NULL,                   -- identificativo del conto nella sessione (cambia a ogni nuova autorizzazione)
  identification_hash TEXT,                       -- identificativo stabile del conto fra le sessioni
  iban           TEXT,
  name           TEXT,
  currency       TEXT DEFAULT 'EUR',
  organization_id INT REFERENCES organizations(id) ON DELETE SET NULL,   -- società intestataria (per chi ha più società)
  attivo         BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE: il conto non si legge più
  saldo          NUMERIC(16,2), saldo_tipo TEXT, saldo_at TIMESTAMPTZ,
  last_sync_at   TIMESTAMPTZ, last_sync_ok_at TIMESTAMPTZ, last_error TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, uid)
);
CREATE INDEX IF NOT EXISTS bank_accounts_iban_idx ON bank_accounts (iban);
CREATE TABLE IF NOT EXISTS bank_transactions (
  id             BIGSERIAL PRIMARY KEY,
  iban           TEXT NOT NULL,                   -- i movimenti appartengono al conto (IBAN), non alla sessione: una nuova autorizzazione non li duplica
  account_id     INT REFERENCES bank_accounts(id) ON DELETE SET NULL,
  chiave         TEXT NOT NULL,                   -- entry_reference della banca, altrimenti impronta di data, importo, controparte e causale
  entry_reference TEXT,
  booking_date   DATE,
  value_date     DATE,
  importo        NUMERIC(16,2) NOT NULL,          -- con segno: positivo = entrata, negativo = uscita
  currency       TEXT NOT NULL DEFAULT 'EUR',
  stato          TEXT NOT NULL DEFAULT 'BOOK',    -- BOOK contabilizzato, PDNG in attesa, ...
  controparte    TEXT,
  controparte_iban TEXT,
  causale        TEXT,
  raw            JSONB,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (iban, chiave)
);
CREATE INDEX IF NOT EXISTS bank_transactions_data_idx ON bank_transactions (booking_date DESC);
CREATE INDEX IF NOT EXISTS bank_transactions_entrate_idx ON bank_transactions (booking_date DESC) WHERE importo > 0;
