-- Programma "anagrafica unica", blocco 3 (08/11/2026). Non distruttiva: solo viste ridefinite, nessun dato toccato.
-- B2: il referente della sede inviante è il responsabile della sede nell'organigramma (public.responsabile_sede, migrazione core 045),
-- non più il testo public.sites.manager_name scritto dal connettore.
SELECT public.vista_sostituisci('nc.sedi_v', 's.manager_name AS referente', 'responsabile_sede(s.id) AS referente');
