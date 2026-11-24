-- Public Affairs (v0.96.0, CEO 24/11/2026): fonti istituzionali da tenere d'occhio (pagine di avvisi e bandi, feed della normativa),
-- voci trovate, sintesi e giudizio di utilità, invii quotidiani. Solo contenuti pubblici: nessun dato personale.
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  full_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'VIEWER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS impostazioni (
  key        TEXT PRIMARY KEY,
  value      JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT
);
CREATE TABLE IF NOT EXISTS fonti (
  id            SERIAL PRIMARY KEY,
  nome          TEXT NOT NULL,
  url           TEXT NOT NULL UNIQUE,
  tipo          TEXT NOT NULL DEFAULT 'PAGINA' CHECK (tipo IN ('PAGINA','RSS')),
  categoria     TEXT NOT NULL DEFAULT 'BANDI' CHECK (categoria IN ('BANDI','NORMATIVA_NAZIONALE','NORMATIVA_REGIONALE','ALTRO')),
  filtro        TEXT,                              -- facoltativo: considera solo i collegamenti il cui indirizzo contiene questo testo
  attiva        BOOLEAN NOT NULL DEFAULT TRUE,
  seme          BOOLEAN NOT NULL DEFAULT FALSE,    -- fonte proposta dalla Suite
  inizializzata BOOLEAN NOT NULL DEFAULT FALSE,    -- prima lettura fatta: ciò che c'era già non è una novità
  letta_at      TIMESTAMPTZ,
  letta_ok_at   TIMESTAMPTZ,
  errore        TEXT,
  errori_di_fila INT NOT NULL DEFAULT 0,
  trovate       INT,                               -- voci viste all'ultima lettura
  created_by    INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS voci (
  id            BIGSERIAL PRIMARY KEY,
  fonte_id      INT NOT NULL REFERENCES fonti(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  titolo        TEXT NOT NULL,
  descrizione   TEXT,
  pubblicata    DATE,
  scadenza      DATE,                              -- letta dal titolo quando c'è ("scadenza 21/10/2026")
  preesistente  BOOLEAN NOT NULL DEFAULT FALSE,    -- c'era già alla prima lettura: non è una novità, non si valuta e non si invia
  vista_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  testo         TEXT,                              -- estratto del documento (pagine pubbliche), per la sintesi
  ai_stato      TEXT NOT NULL DEFAULT 'DA_VALUTARE' CHECK (ai_stato IN ('DA_VALUTARE','VALUTATA','SENZA_AI','ERRORE')),
  utilita       TEXT CHECK (utilita IN ('ALTA','MEDIA','BASSA')),
  linee         TEXT[] NOT NULL DEFAULT '{}',
  sintesi       TEXT,
  motivo        TEXT,
  azione        TEXT,
  approfondita  BOOLEAN NOT NULL DEFAULT FALSE,    -- sintesi fatta sul testo del documento, non sul solo titolo
  ai_errore     TEXT,
  stato         TEXT NOT NULL DEFAULT 'NUOVA' CHECK (stato IN ('NUOVA','LETTA','IN_EVIDENZA','ARCHIVIATA')),
  nota          TEXT,
  inviata_at    TIMESTAMPTZ,
  UNIQUE (fonte_id, url)
);
CREATE INDEX IF NOT EXISTS voci_novita_idx ON voci (vista_at DESC) WHERE NOT preesistente;
CREATE INDEX IF NOT EXISTS voci_da_inviare_idx ON voci (inviata_at) WHERE NOT preesistente;
CREATE TABLE IF NOT EXISTS invii (
  id         SERIAL PRIMARY KEY,
  giorno     DATE NOT NULL UNIQUE,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  destinatari TEXT,
  voci       INT NOT NULL DEFAULT 0,
  esito      TEXT,
  errore     TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(), user_id INT, action TEXT NOT NULL, label TEXT, data JSONB
);
