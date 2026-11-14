-- 14/11/2026 (CEO): profilo "Solo liberi professionisti" (LP) di Contratti del personale: sola lettura dei SOLI LP, nessun dato dei
-- dipendenti (lib/access.js lpGuard: elenco chiuso degli endpoint consentiti). Il ruolo dell'utente del modulo deve poter valere LP.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN','HR','VIEWER','LP'));
