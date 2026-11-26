-- Circolari v0.99.4 (CEO, 26/11/2026). Idempotente.
-- 1) Liste di distribuzione AUTOMATICHE: liste.automatica (SERVICE, PUNTI_PRELIEVO, INTERNI) = destinatari calcolati dall'anagrafica
--    a ogni invio (clienti service attivi, punti prelievo attivi, personale interno), più gli indirizzi aggiunti a mano (destinatari).
-- 2) Conferma di lettura: una riga per destinatario di ogni invio, con un codice personale nel collegamento dell'email.
-- 3) Testo dell'email di invio nelle impostazioni (email_oggetto, email_testo).
ALTER TABLE liste ADD COLUMN IF NOT EXISTS automatica TEXT;
ALTER TABLE liste DROP CONSTRAINT IF EXISTS liste_automatica_check;
ALTER TABLE liste ADD CONSTRAINT liste_automatica_check CHECK (automatica IS NULL OR automatica IN ('SERVICE','PUNTI_PRELIEVO','INTERNI'));
CREATE UNIQUE INDEX IF NOT EXISTS liste_automatica_uq ON liste (automatica) WHERE automatica IS NOT NULL;
INSERT INTO liste (nome, descrizione, segmento, automatica)
SELECT v.nome, v.descr, v.seg, v.auto FROM (VALUES
  ('Service', 'Automatica: tutti i clienti service attivi (Legal entity e sedi service con email). Si aggiorna da sola; sotto si aggiungono altri indirizzi.', 'CLIENTI_SERVICE', 'SERVICE'),
  ('Punti Prelievo', 'Automatica: tutti i punti prelievo attivi e le Legal entity che li ospitano. Si aggiorna da sola; sotto si aggiungono altri indirizzi.', 'PUNTI_PRELIEVO', 'PUNTI_PRELIEVO'),
  ('Interni', 'Automatica: dipendenti e liberi professionisti di Laboratorio e Punti Prelievo, Back Office, Flow Manager, Retail Manager, CEO e COO. Si aggiorna da sola; sotto si aggiungono altri indirizzi.', 'PERSONALE', 'INTERNI')
) v(nome, descr, seg, auto) WHERE NOT EXISTS (SELECT 1 FROM liste l WHERE l.automatica = v.auto);

ALTER TABLE invii ADD COLUMN IF NOT EXISTS con_conferma BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS invii_destinatari (
  id            BIGSERIAL PRIMARY KEY,
  invio_id      INT NOT NULL REFERENCES invii(id) ON DELETE CASCADE,
  circolare_id  INT NOT NULL REFERENCES circolari(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  nome          TEXT,
  codice        TEXT NOT NULL UNIQUE,
  inviata       BOOLEAN NOT NULL DEFAULT TRUE,
  aperta_at     TIMESTAMPTZ,
  confermata_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS invii_destinatari_invio ON invii_destinatari (invio_id);
CREATE INDEX IF NOT EXISTS invii_destinatari_circ ON invii_destinatari (circolare_id);
