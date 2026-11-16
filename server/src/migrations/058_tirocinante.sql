-- 16/11/2026 (CEO): terzo tipo di persona gestito da Gestione del Personale oltre a dipendente e libero professionista: il TIROCINANTE.
-- Non è un rapporto subordinato né un incarico: ha convenzione, progetto formativo, tutor aziendale e giudizio finale
-- (contracts.tirocini, migrazione 023 del modulo). Idempotente e non distruttiva: si allarga soltanto il vincolo.
ALTER TABLE people DROP CONSTRAINT IF EXISTS people_kind_check;
ALTER TABLE people ADD CONSTRAINT people_kind_check CHECK (kind IN ('DIPENDENTE','LP','MEDICO','SANITARIO','TIROCINANTE','ESTERNO'));
