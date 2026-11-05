-- Presa d'atto di Privacy e Informativa IA al primo accesso (richiesta del CEO, 05/11/2026: "Quando fai il login la prima volta,
-- approvare il contenuto dei due documenti e andare avanti"). Vale per tutti gli utenti (dipendenti, clienti service, partner) e si
-- ripresenta quando cambia la versione di una delle due informative (app_settings consensi.*_versione). Una riga per utente, documento
-- e versione: lo storico delle versioni accettate resta.
CREATE TABLE consensi (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  documento    TEXT NOT NULL CHECK (documento IN ('PRIVACY', 'IA')),
  versione     TEXT NOT NULL,
  accettato_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip           TEXT,
  user_agent   TEXT,
  UNIQUE (user_id, documento, versione)
);
CREATE INDEX consensi_doc_idx ON consensi (documento, versione);

-- URL e versioni delle due informative (Amministrazione > Impostazioni > Informative). consensi.ia_url punta alla pagina della Suite
-- finché il CEO non pubblica l'informativa sul sito; cambiare una versione fa riaccettare quel documento a tutti.
INSERT INTO app_settings (key, value) VALUES
  ('consensi.privacy_url', '"https://www.toscanadiagnostica.it/documents/Privacy-Cookie-Policy.pdf"'),
  ('consensi.privacy_versione', '"2026-11"'),
  ('consensi.ia_url', '"/informativa-ia"'),
  ('consensi.ia_versione', '"1.0"')
ON CONFLICT (key) DO NOTHING;
