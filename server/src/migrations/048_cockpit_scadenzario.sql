-- Scadenzario unico di direzione nel Cockpit (decisione del CEO, 08/11/2026). Idempotente: la Suite è in produzione.
-- cockpit_scadenze_viste: "Segna come vista" di un utente su una scadenza (chiave stabile della riga, lib/scadenzario.js) fino a una
--   data compresa; dopo quella data la riga torna visibile. Una riga per utente e chiave (la nuova vista sostituisce la precedente).
-- cockpit_scadenzario_invii: un giorno = una notifica del job core:scadenzario (la chiave primaria evita i doppioni tra istanze).
-- app_settings 'cockpit.scadenzario': impostazioni (Amministrazione > Impostazioni), seminate solo se mancano.
CREATE TABLE IF NOT EXISTS cockpit_scadenze_viste (
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chiave      TEXT NOT NULL CHECK (length(chiave) BETWEEN 3 AND 300),
  fino_a      DATE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, chiave)
);
CREATE INDEX IF NOT EXISTS cockpit_scadenze_viste_fino_idx ON cockpit_scadenze_viste (fino_a);

CREATE TABLE IF NOT EXISTS cockpit_scadenzario_invii (
  giorno  DATE PRIMARY KEY,
  utenti  INT NOT NULL DEFAULT 0,
  righe   INT NOT NULL DEFAULT 0,
  at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO app_settings (key, value) VALUES
  ('cockpit.scadenzario', '{"notifica_attiva": true, "notifica_ora": 8, "proposte_giorni": 30, "ordini_giorni": 2, "circolari_giorni": 7}'::jsonb)
ON CONFLICT (key) DO NOTHING;
