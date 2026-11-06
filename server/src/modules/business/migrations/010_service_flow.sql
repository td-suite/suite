-- Business Hub · linea Service: processo completo da prospect a cliente contrattualizzato (richiesta del CEO del 06/11/2026).
-- Listino StudioLAB per cliente con versioni (v1, v2 scontata, ...) e offerta economica in PDF, form online pubblica con token
-- (anagrafica MOD173, contratto firmato, allegati), kit di proposta inviato da service@, ascolto della casella e contrattualizzazione,
-- comunicazioni automatiche (interne, benvenuto, laboratorio), attivazione dei widget per gli accessi esterni, richiamo periodico dei
-- prospect. Docs: docs/BUSINESS_HUB.md, sezione "Processo Service".

-- Diario: tipi dedicati agli eventi del processo e sottotipo delle email (KIT_PROPOSTA, CONTRATTUALIZZAZIONE, BENVENUTO, NUOVO_CLIENTE_LAB,
-- RICHIAMO, INVITO_SUITE, RISPOSTA_KIT) così "tutto è registrato" e si filtra
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_tipo_check;
ALTER TABLE activities ADD CONSTRAINT activities_tipo_check
  CHECK (tipo IN ('CHIAMATA','EMAIL_IN','EMAIL_OUT','INCONTRO','SOPRALLUOGO','NOTA','OFFERTA','CRITICITA','SISTEMA','PACCHETTO',
                  'LISTINO','OFFERTA_ECONOMICA','ACCESSO','KIT','FORM_B2B','CONTRATTO_FIRMATO','ATTIVAZIONE'));
ALTER TABLE activities ADD COLUMN IF NOT EXISTS sottotipo TEXT;
CREATE INDEX IF NOT EXISTS activities_sottotipo_idx ON activities (account_id, sottotipo) WHERE sottotipo IS NOT NULL;

-- Documenti: listino originale, offerta economica, MOD173 (compilabile e compilato), contratto firmato, allegati del contratto
ALTER TABLE documenti DROP CONSTRAINT IF EXISTS documenti_categoria_check;
ALTER TABLE documenti ADD CONSTRAINT documenti_categoria_check
  CHECK (categoria IN ('ALLEGATO','EMAIL','OFFERTA','VERBALE','ALTRO','PACCHETTO','LISTINO','OFFERTA_ECONOMICA','MOD173','CONTRATTO_FIRMATO','ALLEGATO_CONTRATTO'));
-- Allegati arrivati dal cliente (posta o form) da verificare dall'operatore: "È il contratto firmato" / "Allegato del contratto" / "Non pertinente"
ALTER TABLE documenti ADD COLUMN IF NOT EXISTS da_verificare BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE documenti ADD COLUMN IF NOT EXISTS verificato_at TIMESTAMPTZ;
ALTER TABLE documenti ADD COLUMN IF NOT EXISTS verificato_by INT REFERENCES users(id);
ALTER TABLE documenti ADD COLUMN IF NOT EXISTS etichetta TEXT;            -- titolo dell'allegato del contratto (dalla lista delle Impostazioni)
CREATE INDEX IF NOT EXISTS documenti_verifica_idx ON documenti (account_id) WHERE da_verificare;

-- Account: dati del processo
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS volumi_giornalieri_attesi NUMERIC(12,2);   -- esami al giorno (se vuoto: volume FY / giorni lavorativi)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS data_avvio_prevista DATE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS non_contattare BOOLEAN NOT NULL DEFAULT FALSE;   -- escluso dal richiamo periodico
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ultimo_richiamo_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS listino_corrente_id INT;                     -- NULL = l'ultima versione
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS b2b_token TEXT;                              -- token della form pubblica /b2b/<token>
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS b2b_token_scade DATE;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS b2b_token_at TIMESTAMPTZ;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS contrattualizzato_at TIMESTAMPTZ;             -- contratto firmato ricevuto (comunicazioni partite)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS contrattualizzazione JSONB;                  -- esito delle comunicazioni e dell'attivazione
CREATE UNIQUE INDEX IF NOT EXISTS accounts_b2b_token_uq ON accounts (b2b_token) WHERE b2b_token IS NOT NULL;

-- Listino StudioLAB del cliente: una riga per versione (v1, v2 scontata, ...)
CREATE TABLE IF NOT EXISTS listini (
  id              SERIAL PRIMARY KEY,
  account_id      INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  versione        INT NOT NULL,
  filename        TEXT NOT NULL,
  documento_id    INT REFERENCES documenti(id) ON DELETE SET NULL,     -- l'Excel originale
  note            TEXT,                                                -- es. "sconto richiesto dal cliente"
  mapping         JSONB NOT NULL,                                      -- { campo: indice della colonna } usata per l'import
  intestazioni    JSONB,                                               -- intestazioni del foglio
  righe           JSONB NOT NULL,                                      -- [{ codice, descrizione, settore, listino, offerto, sconto, unita, note }]
  riepilogo       JSONB NOT NULL,                                      -- { esami, totale_listino, totale_offerto, sconto_medio, sconto_medio_semplice }
  differenze      JSONB,                                               -- rispetto alla versione precedente
  caricato_by     INT REFERENCES users(id),
  caricato_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  offerta_documento_id INT REFERENCES documenti(id) ON DELETE SET NULL,  -- offerta economica PDF (ultima generata da questa versione)
  offerta_at      TIMESTAMPTZ,
  offerta_dati    JSONB,                                               -- validità, condizioni, note usate nel PDF
  UNIQUE (account_id, versione)
);
CREATE INDEX IF NOT EXISTS listini_account_idx ON listini (account_id, versione DESC);

-- Anagrafica Clienti B2B (MOD173) inviata dalla form online: una versione per invio
CREATE TABLE IF NOT EXISTS anagrafiche_b2b (
  id            SERIAL PRIMARY KEY,
  account_id    INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  versione      INT NOT NULL,
  dati          JSONB NOT NULL,
  inviata_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip            TEXT,
  documento_id  INT REFERENCES documenti(id) ON DELETE SET NULL,       -- MOD173 compilato in PDF
  activity_id   BIGINT REFERENCES activities(id) ON DELETE SET NULL,
  riempiti      JSONB,                                                -- campi vuoti della Legal entity riempiti in automatico
  differenze    JSONB,                                                -- campi diversi da quelli della Suite: proposte da applicare a mano
  allegati      JSONB,                                                -- documenti caricati con la form [{ documento_id, etichetta, categoria }]
  applicata_at  TIMESTAMPTZ,                                          -- differenze applicate dall'operatore
  applicata_by  INT REFERENCES users(id),
  UNIQUE (account_id, versione)
);

-- Kit di proposta: preparazione (allegati, testo) e invio da service@ (idempotenza per versione del listino)
CREATE TABLE IF NOT EXISTS kit_proposta (
  id             SERIAL PRIMARY KEY,
  account_id     INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  listino_id     INT REFERENCES listini(id) ON DELETE SET NULL,
  listino_versione INT,
  stato          TEXT NOT NULL DEFAULT 'PREPARATO' CHECK (stato IN ('PREPARATO','INVIATO','FALLITO','ANNULLATO')),
  oggetto        TEXT NOT NULL,
  testo          TEXT NOT NULL,
  destinatari    JSONB NOT NULL DEFAULT '[]'::jsonb,
  allegati       JSONB NOT NULL DEFAULT '[]'::jsonb,                   -- [{ documento_id | contract_file_id, filename, size, ruolo }]
  pacchetto_id   INT REFERENCES pacchetti(id) ON DELETE SET NULL,
  avvisi         JSONB,
  preparato_by   INT REFERENCES users(id),
  preparato_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  inviato_activity_id BIGINT REFERENCES activities(id) ON DELETE SET NULL,
  inviato_at     TIMESTAMPTZ,
  inviato_stato  TEXT
);
CREATE INDEX IF NOT EXISTS kit_proposta_account_idx ON kit_proposta (account_id, preparato_at DESC);

-- Pacchetto: variante (BENVENUTO, KIT, PROSPECT)
ALTER TABLE pacchetti ADD COLUMN IF NOT EXISTS variante TEXT NOT NULL DEFAULT 'BENVENUTO';
