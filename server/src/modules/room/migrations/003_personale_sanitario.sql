-- v2.0 · Personale sanitario: professionisti, disponibilità, presenze, turni, rendiconti, bacheca.
-- Nuovi ruoli: PROF (professionista: vede solo il proprio portale), RESP_SAN (Responsabile del personale sanitario: gestisce
-- professionisti, turni, presenze e approva i rendiconti; consulta le sedi).
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN','PLANNER','VIEWER','PROF','RESP_SAN'));

-- Inviti (email + password): token monouso con scadenza.
CREATE TABLE IF NOT EXISTS inviti (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inviti_user ON inviti(user_id);

-- Anagrafica completa del professionista. I dati anagrafici, fiscali, professionali e di compenso stanno in `dati` (JSONB):
--   anagrafica: cognome, nome, sesso, dataNascita, luogoNascita, codiceFiscale, partitaIva, indirizzo, cap, citta, provincia,
--               telefono, cellulare, email, pec, iban, intestatarioConto
--   professionale: tipo (medico|sanitario), profilo (Medico, Infermiere, Tecnico di radiologia, Ostetrica, …), discipline[],
--               specializzazioni[], titoloStudio, albo {ordine, provincia, numero, data}, ecm {crediti, triennio}, competenze[], attrezzature[]
--   contratto: rapporto (LP|DIPENDENTE|CONVENZIONATO|SOCIETA), dal, al, preavvisoGiorni, note
--   assicurazione: compagnia, polizza, massimale, scadenza
--   compenso: tipo (ORARIO|FISSO), tariffaOraria, fissoMensile, eccezioniSede [{sedeId, tariffaOraria}], regime (FORFETTARIO|ORDINARIO|DIPENDENTE),
--             ritenutaAcconto %, cassaPrevidenziale %, ivaPercent, rimborsoKm, note
--   documenti: [{id, tipo, nome, scadenza, note}]  (binari in professionista_docs)
--   sediAbilitate [sedeId], note
CREATE TABLE IF NOT EXISTS professionisti (
  id           SERIAL PRIMARY KEY,
  persona_key  TEXT NOT NULL,              -- chiave normalizzata del nome (stessa delle schede di sede)
  nome         TEXT NOT NULL,              -- "Cognome Nome" come compare nelle sedi
  tipo         TEXT NOT NULL CHECK (tipo IN ('medico','sanitario')),
  profilo      TEXT,
  email        TEXT,
  user_id      INT REFERENCES users(id),
  attivo       BOOLEAN NOT NULL DEFAULT TRUE,
  dati         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   INT REFERENCES users(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS professionisti_key ON professionisti(persona_key);
CREATE INDEX IF NOT EXISTS professionisti_user ON professionisti(user_id);

CREATE TABLE IF NOT EXISTS professionista_docs (
  id          SERIAL PRIMARY KEY,
  prof_id     INT NOT NULL REFERENCES professionisti(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,               -- CV, DOCUMENTO_IDENTITA, ALBO, ASSICURAZIONE, TITOLO, CONTRATTO, ALTRO
  nome        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INT NOT NULL,
  scadenza    DATE,
  note        TEXT,
  data        TEXT NOT NULL,               -- base64
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  INT REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS professionista_docs_prof ON professionista_docs(prof_id);

-- Disponibilità offerte dal professionista: ricorrenti (giorno della settimana, con validità) o puntuali (data).
CREATE TABLE IF NOT EXISTS disponibilita (
  id          SERIAL PRIMARY KEY,
  prof_id     INT NOT NULL REFERENCES professionisti(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('SETTIMANALE','DATA')),
  giorno      SMALLINT CHECK (giorno BETWEEN 0 AND 6),   -- 0 = lunedì
  data        DATE,
  valid_dal   DATE,
  valid_al    DATE,
  ora_da      TEXT NOT NULL,
  ora_a       TEXT NOT NULL,
  sedi        TEXT[] NOT NULL DEFAULT '{}',              -- vuoto = qualsiasi sede
  nota        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS disponibilita_prof ON disponibilita(prof_id);

-- Turni mensili (pianificazione del personale sanitario e medico per sede e giorno). prof_id NULL = turno scoperto.
CREATE TABLE IF NOT EXISTS turni (
  id          SERIAL PRIMARY KEY,
  mese        TEXT NOT NULL,                             -- 'YYYY-MM'
  sede_id     TEXT NOT NULL REFERENCES strutture(id),
  data        DATE NOT NULL,
  ora_da      TEXT NOT NULL,
  ora_a       TEXT NOT NULL,
  prof_id     INT REFERENCES professionisti(id),
  profilo     TEXT,                                      -- profilo richiesto (per i turni scoperti)
  attivita    TEXT,
  room_id     TEXT,
  nota        TEXT,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS turni_mese ON turni(mese, sede_id);
CREATE INDEX IF NOT EXISTS turni_prof ON turni(prof_id, data);

-- Stato del mese di turni: BOZZA (visibile solo a gestione) o CONFERMATO (visibile a tutti e ai professionisti).
CREATE TABLE IF NOT EXISTS turni_mesi (
  mese          TEXT PRIMARY KEY,
  stato         TEXT NOT NULL DEFAULT 'BOZZA' CHECK (stato IN ('BOZZA','CONFERMATO')),
  confermato_da INT REFERENCES users(id),
  confermato_at TIMESTAMPTZ,
  nota          TEXT
);

-- Presenze effettive confermate dal gestore della sede (site manager) per il calcolo dei compensi.
CREATE TABLE IF NOT EXISTS presenze (
  id            SERIAL PRIMARY KEY,
  prof_id       INT NOT NULL REFERENCES professionisti(id),
  sede_id       TEXT NOT NULL REFERENCES strutture(id),
  data          DATE NOT NULL,
  ora_da        TEXT NOT NULL,
  ora_a         TEXT NOT NULL,
  origine       TEXT NOT NULL DEFAULT 'TURNO' CHECK (origine IN ('TURNO','PIANIFICAZIONE','EXTRA')),
  turno_id      INT REFERENCES turni(id) ON DELETE SET NULL,
  stato         TEXT NOT NULL DEFAULT 'CONFERMATA' CHECK (stato IN ('CONFERMATA','ASSENTE')),
  attivita      TEXT,
  nota          TEXT,
  confermato_da INT REFERENCES users(id),
  confermato_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rendiconto_id INT
);
CREATE INDEX IF NOT EXISTS presenze_prof_data ON presenze(prof_id, data);
CREATE INDEX IF NOT EXISTS presenze_sede_data ON presenze(sede_id, data);

-- Rendiconti mensili dei compensi (uno per professionista e mese).
CREATE TABLE IF NOT EXISTS rendiconti (
  id            SERIAL PRIMARY KEY,
  prof_id       INT NOT NULL REFERENCES professionisti(id),
  mese          TEXT NOT NULL,
  stato         TEXT NOT NULL DEFAULT 'BOZZA' CHECK (stato IN ('BOZZA','DA_APPROVARE','APPROVATO','INVIATO','RESPINTO')),
  ore           NUMERIC(8,2) NOT NULL DEFAULT 0,
  importo       NUMERIC(12,2) NOT NULL DEFAULT 0,
  dettaglio     JSONB NOT NULL DEFAULT '{}'::jsonb,      -- righe per presenza, tariffe applicate, fisso, totali
  nota          TEXT,
  generato_da   INT REFERENCES users(id),
  generato_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  approvato_da  INT REFERENCES users(id),
  approvato_at  TIMESTAMPTZ,
  inviato_at    TIMESTAMPTZ,
  email_log_id  INT,
  UNIQUE (prof_id, mese)
);

-- Bacheca: turni scoperti e attività da coprire proposte ai professionisti; candidature.
CREATE TABLE IF NOT EXISTS posizioni (
  id          SERIAL PRIMARY KEY,
  titolo      TEXT NOT NULL,
  sede_id     TEXT REFERENCES strutture(id),
  profilo     TEXT,
  descrizione TEXT,
  dal         DATE,
  al          DATE,
  giorni      SMALLINT[] NOT NULL DEFAULT '{}',          -- giorni della settimana (0 = lunedì); vuoto = vedi descrizione
  ora_da      TEXT,
  ora_a       TEXT,
  stato       TEXT NOT NULL DEFAULT 'APERTA' CHECK (stato IN ('APERTA','ASSEGNATA','CHIUSA')),
  turno_id    INT REFERENCES turni(id) ON DELETE SET NULL,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS candidature (
  id            SERIAL PRIMARY KEY,
  posizione_id  INT NOT NULL REFERENCES posizioni(id) ON DELETE CASCADE,
  prof_id       INT NOT NULL REFERENCES professionisti(id) ON DELETE CASCADE,
  nota          TEXT,
  stato         TEXT NOT NULL DEFAULT 'INVIATA' CHECK (stato IN ('INVIATA','ACCETTATA','RIFIUTATA')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (posizione_id, prof_id)
);

INSERT INTO app_settings (key, value) VALUES
  ('rendiconto_cc', 'amministrazione@toscanadiagnostica.it, backoffice@toscanadiagnostica.it'),
  ('resp_san_nome', 'Federico Stabile')
ON CONFLICT DO NOTHING;
