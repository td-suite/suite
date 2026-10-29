-- Modulo Audit SGI (schema "audit" della Suite, search_path = audit, public). Richiesta del CEO del 29/10/2026.
-- Auto-audit mensili delle sedi (compilati dal Site Manager e verificati da Qualità/Retail/AD), audit interni, audit di terze parti
-- (PDF di certificatori, ASL, ispezioni), audit ISO 37001 sui partner (Legal entity), sintesi con Claude per sede, per TD e per partner.
-- Nessuna anagrafica propria: le sedi sono public.sites, i partner public.organizations, le persone public.users.

-- Riga tecnica dell'utente del modulo (adattatore moduleUser della Suite). Il ruolo è il profilo del grant:
-- ADMIN (Owner/Admin della Suite), QUALITA, AUDITOR, SITE (ambito sede), VIEWER.
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'VIEWER',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Modelli di checklist (body = JSON del modello: parts > sections > items, header_fields, report). Una revisione attiva per kind.
CREATE TABLE IF NOT EXISTS templates (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL,
  title       TEXT NOT NULL,
  rev         TEXT NOT NULL DEFAULT '1',
  rev_date    DATE,
  kind        TEXT NOT NULL CHECK (kind IN ('SEDE','LEGAL_ENTITY')),
  body        JSONB NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by  INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (code, rev)
);

-- Un audit. AUTO: auto-audit mensile della sede (period = primo del mese) con colonna parallela del verificatore;
-- INTERNO: audit interno sulla sede; TERZI: PDF di un ente esterno caricato sulla sede; LEGAL_ENTITY: audit ISO 37001 su un partner.
CREATE TABLE IF NOT EXISTS audits (
  id                SERIAL PRIMARY KEY,
  kind              TEXT NOT NULL CHECK (kind IN ('AUTO','INTERNO','TERZI','LEGAL_ENTITY')),
  site_id           INT REFERENCES public.sites(id) ON DELETE CASCADE,
  organization_id   INT REFERENCES public.organizations(id) ON DELETE CASCADE,
  template_id       INT REFERENCES templates(id) ON DELETE SET NULL,
  period            DATE,                                   -- AUTO: primo giorno del mese
  status            TEXT NOT NULL DEFAULT 'BOZZA' CHECK (status IN ('BOZZA','INVIATO','VERIFICATO','CHIUSO','CARICATO')),
  conducted_by      INT REFERENCES users(id) ON DELETE SET NULL,
  conducted_at      TIMESTAMPTZ,
  verified_by       INT REFERENCES users(id) ON DELETE SET NULL,
  verified_at       TIMESTAMPTZ,
  header            JSONB NOT NULL DEFAULT '{}'::jsonb,     -- effettuato_da, data, relazione, livello_rischio_iniziale...
  answers           JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { itemKey: { v: SI|NO|NC|NA, note, rev, free } }
  verifier_answers  JSONB NOT NULL DEFAULT '{}'::jsonb,     -- stessa forma: colonna parallela del verificatore (solo AUTO)
  ncs               JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{ n, descrizione, cause, soluzione, azione_correttiva, persona_riferimento, entro }]
  observations      TEXT,
  report            JSONB NOT NULL DEFAULT '{}'::jsonb,     -- esito, livello_rischio_finale (Legal entity)
  score             NUMERIC(5,1),                           -- 0-100 (colonna sede / auditor)
  score_verifier    NUMERIC(5,1),                           -- 0-100 (colonna del verificatore, AUTO)
  score_by_section  JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { sectionKey: { score, score_verifier, si, no, nc, na, answered, total } }
  third_party       JSONB NOT NULL DEFAULT '{}'::jsonb,     -- { ente_tipo, ente, data, esito, note, sintesi_testo (dal PDF, max 60k) }
  deleted_at        TIMESTAMPTZ,                            -- cestino (soft delete)
  deleted_by        INT REFERENCES users(id) ON DELETE SET NULL,
  created_by        INT REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind = 'LEGAL_ENTITY' OR site_id IS NOT NULL),
  CHECK (kind <> 'LEGAL_ENTITY' OR organization_id IS NOT NULL)
);
-- un solo auto-audit per sede e mese (tra quelli non eliminati)
CREATE UNIQUE INDEX IF NOT EXISTS audits_auto_uq ON audits (site_id, period) WHERE kind = 'AUTO' AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS audits_site_idx ON audits (site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audits_org_idx ON audits (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audits_status_idx ON audits (status) WHERE deleted_at IS NULL;

-- Allegati: PDF delle terze parti, evidenze (foto, PDF) degli altri audit. Contenuto in data (bytea) oppure su Azure Blob (blob_path).
CREATE TABLE IF NOT EXISTS audit_files (
  id           SERIAL PRIMARY KEY,
  audit_id     INT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  mime         TEXT NOT NULL,
  size         INT NOT NULL DEFAULT 0,
  sha256       TEXT,
  data         BYTEA,
  blob_path    TEXT,
  label        TEXT,                                        -- es. "Rapporto ASL", "Evidenza voce 25"
  uploaded_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_files_audit_idx ON audit_files (audit_id);

-- Sintesi prodotte da Claude: per sede (SEDE), per la rete (TD), per singolo partner (LEGAL_ENTITY), per tutti i partner (LEGAL_ENTITIES)
CREATE TABLE IF NOT EXISTS syntheses (
  id               SERIAL PRIMARY KEY,
  scope            TEXT NOT NULL CHECK (scope IN ('SEDE','TD','LEGAL_ENTITY','LEGAL_ENTITIES')),
  site_id          INT REFERENCES public.sites(id) ON DELETE CASCADE,
  organization_id  INT REFERENCES public.organizations(id) ON DELETE CASCADE,
  generated_by     INT REFERENCES users(id) ON DELETE SET NULL,
  generated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  model            TEXT,
  inputs           JSONB NOT NULL DEFAULT '{}'::jsonb,      -- { audit_ids, periodo, troncato }
  result           JSONB NOT NULL DEFAULT '{}'::jsonb,
  score            NUMERIC(5,1),
  level            TEXT
);
CREATE INDEX IF NOT EXISTS syntheses_scope_idx ON syntheses (scope, site_id, organization_id, generated_at DESC);

-- Alert del 17 inviati (una volta per sede e mese, più i promemoria)
CREATE TABLE IF NOT EXISTS alerts_sent (
  id        SERIAL PRIMARY KEY,
  site_id   INT NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  period    DATE NOT NULL,
  sent_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel   TEXT NOT NULL DEFAULT 'SUITE',                  -- SUITE | EMAIL
  kind      TEXT NOT NULL DEFAULT 'ALERT',                  -- ALERT (primo avviso) | REMINDER
  users     INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS alerts_sent_site_idx ON alerts_sent (site_id, period);

-- Impostazioni del modulo (alert_day, reminder_every_days)
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  INT
);

-- Sedi auditabili: sedi TD attive non SERVICE, con il site manager dall'organigramma (stessa regola di Amministrazione > Sedi e di
-- room.sites_v) e la Legal entity di appartenenza
CREATE OR REPLACE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.short_name, s.kind, s.address, s.zip, s.city, s.province, s.phone, s.email, s.organization_id,
         coalesce(h.person_name, s.manager_name) AS manager_name, h.person_email AS manager_email, h.person_id AS manager_person_id,
         s.active, s.sort_order
    FROM public.sites s
    LEFT JOIN LATERAL (SELECT op.person_id, pp.last_name || ' ' || pp.first_name AS person_name, pp.email AS person_email
                         FROM public.org_units u JOIN public.org_positions op ON op.unit_id = u.id AND op.is_head
                         JOIN public.people pp ON pp.id = op.person_id
                        WHERE u.kind = 'SEDE' AND u.site_id = s.id ORDER BY op.sort_order, op.id LIMIT 1) h ON TRUE
   WHERE s.kind <> 'SERVICE';
