-- Gestione del Personale v0.92.0 (CEO, 21/11/2026): "Segnala Scadenza" dal Calendario delle scadenze e sollecito ogni 7 giorni.
-- Una riga per scadenza segnalata (chiave stabile della scadenza, la stessa dei richiami [TD-SCAD-<chiave>]): prima email di
-- segnalazione, poi un sollecito ogni 7 giorni dall'ultimo invio finché la scadenza resta aperta. Ogni invio è in
-- deadline_signal_sends. Idempotente e non distruttiva.
CREATE TABLE IF NOT EXISTS deadline_signals (
  deadline_key  TEXT PRIMARY KEY,
  resource_id   INT REFERENCES public.people(id) ON DELETE CASCADE,
  deadline_type TEXT,
  title         TEXT,
  due_date      DATE,
  recipient     TEXT,                              -- PERSONA | HR
  to_email      TEXT,
  cc_email      TEXT,
  first_sent_at TIMESTAMPTZ,                       -- prima email di segnalazione riuscita
  last_sent_at  TIMESTAMPTZ,                       -- ultimo invio riuscito (segnalazione o sollecito)
  last_try_at   TIMESTAMPTZ,
  n_solleciti   INT NOT NULL DEFAULT 0,
  last_status   TEXT,                              -- INVIATO | REGISTRATO | FALLITO | SENZA_DESTINATARIO
  last_error    TEXT,
  stopped_at    TIMESTAMPTZ,                       -- solleciti fermati (a mano o perché la scadenza è chiusa)
  stopped_reason TEXT,
  created_by    INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deadline_signals_attive ON deadline_signals (last_sent_at) WHERE stopped_at IS NULL;
CREATE TABLE IF NOT EXISTS deadline_signal_sends (
  id           BIGSERIAL PRIMARY KEY,
  deadline_key TEXT NOT NULL REFERENCES deadline_signals(deadline_key) ON DELETE CASCADE,
  kind         TEXT NOT NULL,                      -- SEGNALAZIONE | SOLLECITO
  n            INT NOT NULL DEFAULT 0,             -- numero del sollecito (0 = segnalazione)
  to_email     TEXT, cc_email TEXT, from_email TEXT, channel TEXT,
  status       TEXT NOT NULL, error TEXT, message_id TEXT,
  sent_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      INT
);
CREATE INDEX IF NOT EXISTS deadline_signal_sends_key ON deadline_signal_sends (deadline_key, sent_at DESC);
