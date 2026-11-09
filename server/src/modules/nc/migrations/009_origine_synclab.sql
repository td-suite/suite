-- v0.67.1: accettazioni importate nel Desk dalla copia Synclab della Suite (lib/synclabDesk.js) con origine SYNCLAB. Idempotente.
ALTER TABLE accettazioni DROP CONSTRAINT IF EXISTS accettazioni_origine_check;
ALTER TABLE accettazioni ADD CONSTRAINT accettazioni_origine_check CHECK (origine IN ('LIS','HL7','PUSH','MANUALE','SYNCLAB'));
