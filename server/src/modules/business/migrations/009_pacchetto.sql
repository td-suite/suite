-- Business Hub · Pacchetto di benvenuto (richiesta del CEO del 06/11/2026): PDF unico per il cliente (lettera del CEO, offerta, portale,
-- credenziali, piano di avvio, Vademecum) generato dalla scheda account e inviato dalla casella della linea. Ogni pacchetto generato
-- resta nei Documenti dell'account (categoria PACCHETTO) con versione e data; nel diario un'attività PACCHETTO; il registro dei
-- pacchetti tiene sezioni, pagine, destinatario, se la password del portale è stampata e l'invio (attività EMAIL_OUT).
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_tipo_check;
ALTER TABLE activities ADD CONSTRAINT activities_tipo_check
  CHECK (tipo IN ('CHIAMATA','EMAIL_IN','EMAIL_OUT','INCONTRO','SOPRALLUOGO','NOTA','OFFERTA','CRITICITA','SISTEMA','PACCHETTO'));
ALTER TABLE documenti DROP CONSTRAINT IF EXISTS documenti_categoria_check;
ALTER TABLE documenti ADD CONSTRAINT documenti_categoria_check
  CHECK (categoria IN ('ALLEGATO','EMAIL','OFFERTA','VERBALE','ALTRO','PACCHETTO'));

CREATE TABLE IF NOT EXISTS pacchetti (
  id                  SERIAL PRIMARY KEY,
  account_id          INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  versione            INT NOT NULL,
  data                DATE NOT NULL,                                   -- data del pacchetto (copertina, lettera, piano 30-60-90)
  documento_id        INT REFERENCES documenti(id) ON DELETE SET NULL,
  activity_id         BIGINT REFERENCES activities(id) ON DELETE SET NULL,
  contatto_id         INT REFERENCES contatti(id) ON DELETE SET NULL,  -- referente destinatario
  destinatario        TEXT,
  sezioni             JSONB NOT NULL,                                  -- [{ key, titolo, inclusa, motivo, pagina }]
  avvisi              JSONB,
  pagine              INT,
  bytes               INT,
  offerta             TEXT,                                            -- PDF (lettera generata) | ECONOMICA | null
  password_inclusa    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by          INT REFERENCES users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  inviato_activity_id BIGINT REFERENCES activities(id) ON DELETE SET NULL,
  inviato_at          TIMESTAMPTZ,
  inviato_stato       TEXT,
  UNIQUE (account_id, versione)
);
CREATE INDEX IF NOT EXISTS pacchetti_account_idx ON pacchetti (account_id, versione DESC);
