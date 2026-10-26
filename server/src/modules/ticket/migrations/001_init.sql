-- Modulo Ticket (schema "ticket" della Suite, search_path = ticket, public).
-- Richieste e segnalazioni ai responsabili delle unità dell'organigramma: protocollo TK-AAAA/NNNN, SLA per priorità,
-- cronologia completa, allegati, statistiche. Nessuna copia dell'anagrafica: FK esplicite verso public.users, public.people,
-- public.sites, public.organizations, public.org_units.

-- Riga tecnica dell'utente del modulo (creata dall'adattatore moduleUser della Suite). Il ruolo è il profilo del grant
-- (ADMIN, RESPONSABILE, VIEWER) oppure UTENTE, implicito per chiunque sia autenticato nella Suite.
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'UTENTE',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Categorie: casella di destinazione predefinita (nullable: la imposta l'amministratore; se manca sceglie il richiedente)
CREATE TABLE IF NOT EXISTS categorie (
  id                SERIAL PRIMARY KEY,
  nome              TEXT NOT NULL,
  descrizione       TEXT NOT NULL DEFAULT '',
  unit_id           INT REFERENCES public.org_units(id) ON DELETE SET NULL,
  priorita_default  TEXT NOT NULL DEFAULT 'P3' CHECK (priorita_default IN ('P1','P2','P3','P4')),
  riservata         BOOLEAN NOT NULL DEFAULT FALSE,
  attiva            BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INT NOT NULL DEFAULT 100,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SLA per priorità (ore): prima risposta e risoluzione
CREATE TABLE IF NOT EXISTS sla (
  priorita            TEXT PRIMARY KEY CHECK (priorita IN ('P1','P2','P3','P4')),
  etichetta           TEXT NOT NULL,
  prima_risposta_ore  INT NOT NULL,
  risoluzione_ore     INT NOT NULL,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id                        SERIAL PRIMARY KEY,
  anno                      INT NOT NULL,
  numero                    INT NOT NULL,
  protocollo                TEXT NOT NULL UNIQUE,                 -- TK-2026/0001
  titolo                    TEXT NOT NULL,
  descrizione               TEXT NOT NULL DEFAULT '',
  categoria_id              INT REFERENCES categorie(id) ON DELETE SET NULL,
  priorita                  TEXT NOT NULL DEFAULT 'P3' CHECK (priorita IN ('P1','P2','P3','P4')),
  stato                     TEXT NOT NULL DEFAULT 'APERTO' CHECK (stato IN ('APERTO','IN_CORSO','IN_ATTESA','RISOLTO','CHIUSO','ANNULLATO')),
  riservato                 BOOLEAN NOT NULL DEFAULT FALSE,
  anonimo                   BOOLEAN NOT NULL DEFAULT FALSE,       -- riservati: nome del richiedente nascosto fuori dalla casella destinataria
  richiedente_user_id       INT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  richiedente_person_id     INT REFERENCES public.people(id) ON DELETE SET NULL,
  per_conto_site_id         INT REFERENCES public.sites(id) ON DELETE SET NULL,
  per_conto_org_id          INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  unit_id                   INT NOT NULL REFERENCES public.org_units(id) ON DELETE RESTRICT,   -- casella destinataria
  assegnatario_user_id      INT REFERENCES public.users(id) ON DELETE SET NULL,
  prima_risposta_at         TIMESTAMPTZ,
  risolto_at                TIMESTAMPTZ,
  chiuso_at                 TIMESTAMPTZ,
  sla_risposta_scadenza     TIMESTAMPTZ NOT NULL,
  sla_risoluzione_scadenza  TIMESTAMPTZ NOT NULL,
  sla_risposta_sforato      BOOLEAN NOT NULL DEFAULT FALSE,
  sla_risoluzione_sforato   BOOLEAN NOT NULL DEFAULT FALSE,
  attesa_secondi            INT NOT NULL DEFAULT 0,               -- tempo complessivo passato IN_ATTESA (non conta per lo SLA)
  attesa_da                 TIMESTAMPTZ,                          -- inizio dell'attesa in corso
  escalation_unit_id        INT REFERENCES public.org_units(id) ON DELETE SET NULL,
  escalated_at              TIMESTAMPTZ,
  valutazione               SMALLINT CHECK (valutazione BETWEEN 1 AND 5),
  valutazione_nota          TEXT,
  riaperture                INT NOT NULL DEFAULT 0,
  messaggio_risoluzione     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  fts                       TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('italian', coalesce(protocollo,'') || ' ' || coalesce(titolo,'')), 'A') ||
    setweight(to_tsvector('italian', coalesce(descrizione,'')), 'B')
  ) STORED,
  UNIQUE (anno, numero)
);
CREATE INDEX IF NOT EXISTS tickets_fts ON tickets USING GIN (fts);
CREATE INDEX IF NOT EXISTS tickets_stato ON tickets (stato, priorita, sla_risoluzione_scadenza);
CREATE INDEX IF NOT EXISTS tickets_unit ON tickets (unit_id);
CREATE INDEX IF NOT EXISTS tickets_richiedente ON tickets (richiedente_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS tickets_assegnatario ON tickets (assegnatario_user_id);

-- Commenti: pubblici (visibili al richiedente e agli osservatori) o note interne (solo gestori)
CREATE TABLE IF NOT EXISTS commenti (
  id              SERIAL PRIMARY KEY,
  ticket_id       INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  autore_user_id  INT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  testo           TEXT NOT NULL,
  interno         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commenti_ticket ON commenti (ticket_id, created_at);

-- Allegati (BYTEA nello schema del modulo, come i documenti di Circolari)
CREATE TABLE IF NOT EXISTS allegati (
  id                  SERIAL PRIMARY KEY,
  ticket_id           INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  commento_id         INT REFERENCES commenti(id) ON DELETE SET NULL,
  filename            TEXT NOT NULL,
  mime                TEXT NOT NULL,
  size                INT NOT NULL,
  data                BYTEA NOT NULL,
  caricato_da_user_id INT NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS allegati_ticket ON allegati (ticket_id);

-- Cronologia completa
CREATE TABLE IF NOT EXISTS eventi (
  id          SERIAL PRIMARY KEY,
  ticket_id   INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('APERTO','PRESO_IN_CARICO','ASSEGNATO','GIRATO','STATO','PRIORITA','COMMENTO','NOTA','ALLEGATO','ESCALATION','RIAPERTO','CHIUSO','VALUTATO','LETTURA_RISERVATO','ANNULLATO','MODIFICA','OSSERVATORE')),
  user_id     INT REFERENCES public.users(id) ON DELETE SET NULL,   -- NULL = sistema (job)
  dati        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventi_ticket ON eventi (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS osservatori (
  ticket_id   INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  user_id     INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, user_id)
);

CREATE TABLE IF NOT EXISTS impostazioni (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Discendenti (inclusi) di un insieme di unità dell'organigramma: i responsabili di una casella vedono anche le caselle sotto
CREATE OR REPLACE FUNCTION ticket.unit_subtree(roots INT[]) RETURNS TABLE(id INT) LANGUAGE sql STABLE AS $$
  WITH RECURSIVE down AS (
    SELECT u.id, 0 AS depth FROM public.org_units u WHERE u.id = ANY(roots)
    UNION
    SELECT u.id, down.depth + 1 FROM public.org_units u JOIN down ON u.parent_id = down.id WHERE down.depth < 12
  )
  SELECT DISTINCT id FROM down;
$$;

-- Unità di cui un utente della Suite è responsabile (incarico is_head, oppure head_person_id allineato)
CREATE OR REPLACE FUNCTION ticket.managed_units(uid INT) RETURNS TABLE(id INT) LANGUAGE sql STABLE AS $$
  SELECT DISTINCT op.unit_id FROM public.org_positions op JOIN public.users u ON u.person_id = op.person_id WHERE u.id = uid AND op.is_head
  UNION
  SELECT ou.id FROM public.org_units ou JOIN public.users u ON u.person_id = ou.head_person_id WHERE u.id = uid AND ou.active;
$$;

-- Seed: categorie (casella predefinita NULL, la imposta l'amministratore), SLA, impostazioni
INSERT INTO categorie (nome, descrizione, priorita_default, riservata, sort_order) VALUES
  ('Business e commerciale', 'Offerte, convenzioni, clienti, listini, richieste dai punti e dai partner', 'P3', FALSE, 10),
  ('Operations e logistica', 'Trasporti, ritiri, consegne, materiali, magazzino', 'P2', FALSE, 20),
  ('Sedi e manutenzione', 'Guasti, impianti, arredi, pulizie, sicurezza degli ambienti delle sedi', 'P2', FALSE, 30),
  ('Sistemi e dispositivi', 'Computer, stampanti, rete, LIS, account, telefonia', 'P2', FALSE, 40),
  ('Qualità e sicurezza', 'Procedure, moduli SGI, audit, segnalazioni di qualità e sicurezza sul lavoro', 'P3', FALSE, 50),
  ('Personale e amministrazione', 'Ferie, permessi, buste paga, contratti, documenti amministrativi', 'P3', FALSE, 60),
  ('Service di laboratorio', 'Richieste dei laboratori clienti: esami, tempi, referti, trasporti dedicati', 'P2', FALSE, 70),
  ('Finance', 'Fatture, pagamenti, rimborsi, note spese, cassa', 'P3', FALSE, 80),
  ('Segnalazione riservata', 'Segnalazione visibile solo ai responsabili della casella destinataria e all''amministratore del modulo', 'P2', TRUE, 90),
  ('Altro', 'Tutto ciò che non rientra nelle altre categorie', 'P4', FALSE, 100)
ON CONFLICT DO NOTHING;

INSERT INTO sla (priorita, etichetta, prima_risposta_ore, risoluzione_ore) VALUES
  ('P1', 'Critica', 4, 24), ('P2', 'Alta', 8, 72), ('P3', 'Normale', 48, 240), ('P4', 'Bassa', 120, 720)
ON CONFLICT (priorita) DO NOTHING;

INSERT INTO impostazioni (key, value) VALUES
  ('chiusura_automatica_giorni', '7'),
  ('escalation_attiva', 'true'),
  ('max_aperture_giorno', '20'),
  ('avviso_privacy', '"Non inserire dati di pazienti (nomi, referti, codici fiscali). Il ticket è visibile ai responsabili della casella destinataria e della catena gerarchica sopra di essa."'),
  ('avviso_riservato', '"La segnalazione riservata è visibile solo ai responsabili della casella destinataria e all''amministratore del modulo. Questo non è il canale di segnalazione previsto dal D.lgs. 24/2023 (whistleblowing): per quelle segnalazioni usa il canale ufficiale indicato nella procedura aziendale."')
ON CONFLICT (key) DO NOTHING;
