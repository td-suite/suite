-- Audit SGI v0.84.0 (richiesta del CEO del 18/11/2026): modello dedicato al Laboratorio di Analisi (TD-AUD-LAB) accanto a quello
-- delle sedi (punti prelievo e centri medici). Idempotente, non distruttiva: allarga solo i valori ammessi di templates.kind.
ALTER TABLE templates DROP CONSTRAINT IF EXISTS templates_kind_check;
ALTER TABLE templates ADD CONSTRAINT templates_kind_check CHECK (kind IN ('SEDE','LABORATORIO','LEGAL_ENTITY'));
