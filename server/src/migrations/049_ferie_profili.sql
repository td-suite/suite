-- Piano Ferie (CEO, 08/11/2026): i profili sono Amministratore, Responsabile di area e Utente (compila il proprio piano). Il profilo
-- Consultazione (VIEWER, vedeva tutte le aree) non esiste più: i grant già assegnati diventano Utente. Idempotente, nessun dato perso.
UPDATE grants SET profile = 'DIPENDENTE', updated_at = now() WHERE module_key = 'ferie' AND profile = 'VIEWER';
