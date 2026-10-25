-- v1.1: calendario reale (assenze, sostituzioni, chiusure), registro email, avvisi

CREATE TABLE eventi (
  id              SERIAL PRIMARY KEY,
  kind            TEXT NOT NULL CHECK (kind IN ('ASSENZA','CHIUSURA','SESSIONE_EXTRA')),
  -- persona interessata (per ASSENZA / SESSIONE_EXTRA): chiave specialista cross-sede + riferimento alla scheda di sede
  persona_key     TEXT,
  persona_nome    TEXT,
  sede_id         TEXT REFERENCES strutture(id) ON DELETE CASCADE,  -- per CHIUSURA la sede chiusa; per ASSENZA la sede dove vale (NULL = tutte)
  persona_id      TEXT,
  dal             DATE NOT NULL,
  al              DATE NOT NULL,
  -- sostituto (ASSENZA): persona di sede che copre le sessioni
  sost_persona_id TEXT,
  sost_nome       TEXT,
  -- sessione extra (SESSIONE_EXTRA): ambulatorio e orario in una data precisa
  room_id         TEXT,
  ora_da          TEXT,
  ora_a           TEXT,
  nota            TEXT,
  created_by      INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (al >= dal)
);
CREATE INDEX eventi_range ON eventi (dal, al);

CREATE TABLE email_log (
  id              BIGSERIAL PRIMARY KEY,
  kind            TEXT NOT NULL,
  ref_key         TEXT,
  sede_id         TEXT,
  to_addr         TEXT NOT NULL,
  cc_addr         TEXT,
  subject         TEXT NOT NULL,
  body            TEXT,
  attachment_name TEXT,
  status          TEXT NOT NULL,
  error           TEXT,
  sent_by         INT,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX email_log_at ON email_log (at DESC);

INSERT INTO app_settings (key, value) VALUES ('crit_soglia', '5'), ('crit_alert_enabled', 'false'), ('crit_alert_hour', '8') ON CONFLICT DO NOTHING;
