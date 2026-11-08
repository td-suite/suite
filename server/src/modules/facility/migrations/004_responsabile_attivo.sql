-- A8 (programma anagrafica unica, 08/11/2026): il responsabile di sede letto dall'organigramma è solo una persona ATTIVA (prima una
-- persona cessata restava responsabile e destinataria degli avvisi). La vista sites_v si ridefinisce dalla sua definizione corrente
-- con la funzione del core public.responsabili_solo_attivi (migrazione core 043): idempotente, nessun dato toccato.
SELECT public.responsabili_solo_attivi('facility.sites_v');
