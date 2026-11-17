-- v0.79.0 (richieste del CEO del 17/11/2026). Idempotente e non distruttiva.
-- 1) ECM: una risorsa si può NON considerare per un anno (maternità, lunga assenza, ingresso a fine anno...). L'anno escluso non ha
--    obiettivo, scadenze né richiami e non entra negli indicatori; l'obbligo del triennio non cambia (per ridurlo c'è "riduzione").
ALTER TABLE ecm_profili ADD COLUMN IF NOT EXISTS anni_esclusi INT[] NOT NULL DEFAULT '{}';
ALTER TABLE ecm_profili ADD COLUMN IF NOT EXISTS esclusione_motivo TEXT;
-- 2) Profilo MDL: sola visualizzazione delle scadenze di medicina del lavoro (per il responsabile HQS). Elenco chiuso in lib/access.js.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN','HR','VIEWER','LP','MDL'));
