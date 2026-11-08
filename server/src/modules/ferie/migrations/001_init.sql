-- Modulo Piano Ferie (schema "ferie" della Suite, search_path = ferie, public).
-- Decisione del CEO (08/11/2026): "widget dedicato per le ferie annuali; solo dipendenti; piano ferie per Area: Direzione,
-- Laboratorio, Sedi". Nessuna copia dell'anagrafica: FK esplicite verso public.people, public.users, public.sites, public.job_roles.
-- Il perimetro (persone DIPENDENTE attive con contratto in contracts.employments) e l'Area di ciascuna si calcolano a ogni lettura
-- dall'organigramma (public.org_units, public.org_positions): qui stanno solo i dati propri del modulo.
-- Migrazione idempotente (la Suite è in produzione): IF NOT EXISTS ovunque, semi con ON CONFLICT DO NOTHING.

-- Riga tecnica dell'utente del modulo (creata dall'adattatore moduleUser della Suite). Il ruolo è il profilo del grant
-- (ADMIN, RESPONSABILE, VIEWER) oppure DIPENDENTE, implicito per chi è autenticato senza grant (modulo aperto a tutti gli interni).
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'DIPENDENTE',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Impostazioni del modulo (chiave → valore JSON); i valori predefiniti stanno in lib/core.js (DEFAULTS)
CREATE TABLE IF NOT EXISTS impostazioni (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Giorni di ferie annui per CCNL e livello (il contratto di lavoro non ha un campo ferie: impostazione HR).
-- level '*' = tutti i livelli del CCNL; ccnl '*' = qualunque CCNL. rol_ore_annue facoltativo (ROL/permessi, voce separata).
CREATE TABLE IF NOT EXISTS spettanze (
  ccnl           TEXT NOT NULL DEFAULT '*',
  level          TEXT NOT NULL DEFAULT '*',
  giorni_annui   NUMERIC(5,2) NOT NULL CHECK (giorni_annui >= 0 AND giorni_annui <= 60),
  rol_ore_annue  NUMERIC(6,2) CHECK (rol_ore_annue IS NULL OR (rol_ore_annue >= 0 AND rol_ore_annue <= 400)),
  note           TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ccnl, level)
);
-- Ipotesi dichiarata (brief del CEO): 26 giorni per tutti finché HR non imposta i valori del CCNL. Da verificare con il consulente.
INSERT INTO spettanze (ccnl, level, giorni_annui, note) VALUES ('*', '*', 26, 'Ipotesi predefinita da verificare con il consulente del lavoro sul testo del CCNL')
ON CONFLICT (ccnl, level) DO NOTHING;

-- Saldo annuo della persona: residuo dell'anno precedente (inserimento HR a mano o da XLSX) ed eventuali forzature
CREATE TABLE IF NOT EXISTS saldi (
  person_id            INT NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  anno                 INT NOT NULL CHECK (anno BETWEEN 2000 AND 2100),
  residuo_ap           NUMERIC(6,2) NOT NULL DEFAULT 0,          -- giorni di ferie non goduti dell'anno precedente
  rol_residuo_ap_ore   NUMERIC(7,2),                             -- ore ROL/permessi residue dell'anno precedente (facoltativo)
  giorni_annui         NUMERIC(5,2),                             -- forzatura della spettanza annua (NULL = da CCNL/livello)
  rol_ore_annue        NUMERIC(6,2),                             -- forzatura delle ore ROL annue (NULL = da CCNL/livello)
  note                 TEXT,
  fonte                TEXT NOT NULL DEFAULT 'MANUALE' CHECK (fonte IN ('MANUALE','XLSX')),
  updated_by_user_id   INT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, anno)
);

-- Periodi di chiusura collettiva per area (HR li imposta; proposti ai dipendenti dell'area). gruppo: TUTTE, DIR, LAB, SEDE:<id>
CREATE TABLE IF NOT EXISTS chiusure (
  id                  SERIAL PRIMARY KEY,
  gruppo              TEXT NOT NULL CHECK (gruppo ~ '^(TUTTE|DIR|LAB|SEDE:[0-9]+)$'),
  data_inizio         DATE NOT NULL,
  data_fine           DATE NOT NULL,
  descrizione         TEXT NOT NULL DEFAULT '',
  created_by_user_id  INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (data_fine >= data_inizio)
);
CREATE INDEX IF NOT EXISTS chiusure_periodo ON chiusure (data_inizio, data_fine);

-- Richieste di ferie (giorni) e di ROL/permessi (ore)
CREATE TABLE IF NOT EXISTS richieste (
  id                     SERIAL PRIMARY KEY,
  person_id              INT NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  anno                   INT NOT NULL,
  tipo                   TEXT NOT NULL DEFAULT 'FERIE' CHECK (tipo IN ('FERIE','ROL')),
  data_inizio            DATE NOT NULL,
  data_fine              DATE NOT NULL,
  mezza_inizio           BOOLEAN NOT NULL DEFAULT FALSE,          -- il primo giorno solo il pomeriggio
  mezza_fine             BOOLEAN NOT NULL DEFAULT FALSE,          -- l'ultimo giorno solo la mattina
  giorni                 NUMERIC(6,2) NOT NULL DEFAULT 0,         -- giorni lavorativi conteggiati (ferie)
  ore                    NUMERIC(6,2),                            -- ore (ROL/permessi)
  note                   TEXT NOT NULL DEFAULT '',
  stato                  TEXT NOT NULL DEFAULT 'RICHIESTA' CHECK (stato IN ('RICHIESTA','APPROVATA','RIFIUTATA','GODUTA','ANNULLATA')),
  gruppo                 TEXT,                                    -- area al momento della richiesta (DIR, LAB, SEDE:<id>)
  approvatore_person_id  INT REFERENCES public.people(id) ON DELETE SET NULL,
  chiusura_id            INT REFERENCES chiusure(id) ON DELETE SET NULL,
  inserita_da_user_id    INT REFERENCES public.users(id) ON DELETE SET NULL,
  deciso_da_user_id      INT REFERENCES public.users(id) ON DELETE SET NULL,
  deciso_at              TIMESTAMPTZ,
  nota_decisione         TEXT,
  sotto_copertura        BOOLEAN NOT NULL DEFAULT FALSE,          -- avviso non bloccante per l'approvatore
  copertura              JSONB NOT NULL DEFAULT '[]',             -- dettaglio dei giorni sotto la copertura minima
  annullata_da_user_id   INT REFERENCES public.users(id) ON DELETE SET NULL,
  annullata_at           TIMESTAMPTZ,
  goduta_at              TIMESTAMPTZ,
  promemoria_at          TIMESTAMPTZ,                             -- ultimo promemoria all'approvatore (job ferie:promemoria)
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (data_fine >= data_inizio)
);
CREATE INDEX IF NOT EXISTS richieste_person ON richieste (person_id, anno);
CREATE INDEX IF NOT EXISTS richieste_periodo ON richieste (data_inizio, data_fine) WHERE stato IN ('RICHIESTA','APPROVATA','GODUTA');
CREATE INDEX IF NOT EXISTS richieste_stato ON richieste (stato, created_at);
CREATE INDEX IF NOT EXISTS richieste_approvatore ON richieste (approvatore_person_id) WHERE stato = 'RICHIESTA';
CREATE INDEX IF NOT EXISTS richieste_chiusura ON richieste (chiusura_id);
CREATE INDEX IF NOT EXISTS richieste_inserita ON richieste (inserita_da_user_id);
CREATE INDEX IF NOT EXISTS richieste_deciso ON richieste (deciso_da_user_id);
CREATE INDEX IF NOT EXISTS richieste_annullata ON richieste (annullata_da_user_id);

-- Cronologia delle richieste. user_id NULL = sistema (job)
CREATE TABLE IF NOT EXISTS eventi (
  id           SERIAL PRIMARY KEY,
  richiesta_id INT NOT NULL REFERENCES richieste(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('RICHIESTA','APPROVATA','RIFIUTATA','GODUTA','ANNULLATA','PROMEMORIA','MODIFICA')),
  user_id      INT REFERENCES public.users(id) ON DELETE SET NULL,
  dati         JSONB NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventi_richiesta ON eventi (richiesta_id, created_at);
CREATE INDEX IF NOT EXISTS eventi_user ON eventi (user_id);

-- Copertura minima per giorno: numero minimo di presenti per ruolo (job_roles; NULL = chiunque) in un ambito
-- ambito: DIR, LAB, SEDE:<id> (una sede), KIND:<tipo sede> (tutte le sedi di quel tipo, es. KIND:PUNTO_PRELIEVI)
CREATE TABLE IF NOT EXISTS coperture (
  id          SERIAL PRIMARY KEY,
  ambito      TEXT NOT NULL CHECK (ambito ~ '^(DIR|LAB|SEDE:[0-9]+|KIND:[A-Z_]+)$'),
  role_id     INT REFERENCES public.job_roles(id) ON DELETE CASCADE,
  minimo      INT NOT NULL CHECK (minimo BETWEEN 1 AND 99),
  note        TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS coperture_uq ON coperture (ambito, coalesce(role_id, 0));
CREATE INDEX IF NOT EXISTS coperture_role ON coperture (role_id);

-- Area forzata di una persona (impostazione del modulo): prevale su quella derivata dall'organigramma
CREATE TABLE IF NOT EXISTS aree_forzate (
  person_id           INT PRIMARY KEY REFERENCES public.people(id) ON DELETE CASCADE,
  gruppo              TEXT NOT NULL CHECK (gruppo ~ '^(DIR|LAB|SEDE:[0-9]+)$'),
  note                TEXT NOT NULL DEFAULT '',
  updated_by_user_id  INT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Santo patrono per sede (giorno festivo locale, impostazione HR: nessun valore precompilato)
CREATE TABLE IF NOT EXISTS patroni (
  site_id     INT PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  giorno      TEXT NOT NULL CHECK (giorno ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),   -- MM-GG
  santo       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deleghe di approvazione (es. il responsabile in ferie delega un collega per un periodo). HR (ADMIN) approva sempre.
CREATE TABLE IF NOT EXISTS deleghe (
  id                   SERIAL PRIMARY KEY,
  delegante_person_id  INT NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  delegato_person_id   INT NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  dal                  DATE NOT NULL,
  al                   DATE NOT NULL,
  note                 TEXT NOT NULL DEFAULT '',
  created_by_user_id   INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (al >= dal),
  CHECK (delegante_person_id <> delegato_person_id)
);
CREATE INDEX IF NOT EXISTS deleghe_delegante ON deleghe (delegante_person_id);
CREATE INDEX IF NOT EXISTS deleghe_delegato ON deleghe (delegato_person_id);
