-- Circolari v0.99.5 (CEO, 26/11/2026). Idempotente.
-- 1) Lista Interni A SCELTA: liste.persone = id delle persone spuntate dall'elenco del personale (l'indirizzo si legge dall'utente a ogni invio).
--    Nasce vuota: finché non si sceglie qualcuno la lista Interni non ha destinatari (oltre agli indirizzi aggiunti a mano).
-- 2) Lista Punti Prelievo: solo i punti prelievo attivi (tolte le Legal entity che li ospitano). Si aggiorna la descrizione
--    delle due liste solo se è ancora quella scritta dalla migrazione 006.
ALTER TABLE liste ADD COLUMN IF NOT EXISTS persone INT[] NOT NULL DEFAULT '{}';
UPDATE liste SET descrizione = 'Automatica: tutti i punti prelievo attivi con email. Si aggiorna da sola; sotto si aggiungono altri indirizzi.'
 WHERE automatica = 'PUNTI_PRELIEVO' AND descrizione LIKE 'Automatica: tutti i punti prelievo attivi e le Legal entity che li ospitano.%';
UPDATE liste SET descrizione = 'A scelta: i destinatari si selezionano dall''elenco del personale (dipendenti e liberi professionisti con utente attivo). Sotto si aggiungono altri indirizzi.'
 WHERE automatica = 'INTERNI' AND descrizione LIKE 'Automatica: dipendenti e liberi professionisti di Laboratorio e Punti Prelievo,%';
