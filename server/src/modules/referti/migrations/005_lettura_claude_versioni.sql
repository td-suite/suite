-- 03/11/2026, richiesta del CEO ("Dobbiamo completamente cambiare il funzionamento di Referti Esterni"): nuovo motore.
-- - Lettura del PDF con Claude (lib/lettura.js) e JSON della scheda a blocchi che rispecchia le chiamate del generatore del progetto
--   (lib/blocchi.js, lib/formatTD.js): schede.dati = { anagrafica: { cognome_nome, righe }, blocchi: [...], nome_file, sorgente,
--   note_anomalie }. I parser a mano restano solo come riserva (senza chiave Anthropic).
-- - "Chiedi una correzione": ogni versione dei dati resta in scheda_versioni (LETTURA, CORREZIONE, MANUALE); "Annulla l'ultima
--   correzione" torna alla versione precedente.
-- - Le schede in BOZZA con il vecchio schema (senza "blocchi") NON si convertono: vengono marcate da rielaborare e si rileggono dal
--   PDF ("Rielabora dal PDF"). Le schede CONFERMATE restano con i loro file; se si riaprono, si rielaborano.

ALTER TABLE schede ADD COLUMN IF NOT EXISTS lettura TEXT;                         -- CLAUDE | MOCK | RISERVA (NULL = vecchio motore)
ALTER TABLE schede ADD COLUMN IF NOT EXISTS antibiotici_sorgente INT;             -- conteggio indipendente sul testo della sorgente
ALTER TABLE schede ADD COLUMN IF NOT EXISTS da_rielaborare BOOLEAN NOT NULL DEFAULT FALSE;
COMMENT ON COLUMN schede.dati IS 'JSON a blocchi del generatore format TD: { anagrafica: { cognome_nome, righe }, blocchi, nome_file, sorgente, note_anomalie }';
COMMENT ON COLUMN schede.dati_orig IS 'Prima lettura del PDF (Claude, simulata o parser di riserva), non modificabile';
COMMENT ON COLUMN schede.lettura IS 'Come è stata letta la scheda: CLAUDE, MOCK (REFERTI_AI_MOCK, collaudo), RISERVA (parser senza Claude)';
COMMENT ON COLUMN schede.da_rielaborare IS 'Scheda in bozza con il JSON del vecchio motore: va riletta dal PDF prima della conferma';

UPDATE schede SET da_rielaborare = TRUE WHERE stato = 'BOZZA' AND NOT (dati ? 'blocchi');

-- Versioni dei dati della scheda: n crescente per scheda; origine LETTURA (prima lettura o rielaborazione), CORREZIONE (Chiedi una
-- correzione, con l'istruzione dell'operatore), MANUALE (modifica dei campi dalla scheda)
CREATE TABLE IF NOT EXISTS scheda_versioni (
  id          SERIAL PRIMARY KEY,
  scheda_id   INT NOT NULL REFERENCES schede(id) ON DELETE CASCADE,
  n           INT NOT NULL,
  dati        JSONB NOT NULL,
  origine     TEXT NOT NULL CHECK (origine IN ('LETTURA','CORREZIONE','MANUALE')),
  istruzione  TEXT,
  user_id     INT REFERENCES public.users(id) ON DELETE SET NULL,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scheda_id, n)
);
CREATE INDEX IF NOT EXISTS scheda_versioni_scheda_idx ON scheda_versioni (scheda_id, n DESC);
