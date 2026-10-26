-- Pianificabili ed esclusi (decisione del CEO, 26/10/2026): in Room Planning compaiono TUTTE le persone dell'anagrafica unica
-- (public.people), non solo alcuni tipi. Chi non va pianificato (per esempio chi non è sanitario) si esclude a mano, persona per
-- persona, con il flag person_ext.planning_excluded; i dipendenti non si escludono a priori perché esistono sanitari dipendenti.
--   person_ext.planning_excluded  TRUE = la persona non compare nei selettori di turni, disponibilità, presenze e calendario.
--   person_ext.tipo               ora facoltativo: la riga può esistere solo per il flag di esclusione, senza scheda Room compilata
--                                 (la scheda Room "c'è" quando tipo è valorizzato: colonna in_room della vista).
-- La vista professionisti_v non filtra più per tipo di persona ed espone anche sede di lavoro (nome), ruolo del catalogo
-- (public.job_roles), il flag di esclusione e pianificabile = attivo e non escluso.

ALTER TABLE person_ext ADD COLUMN IF NOT EXISTS planning_excluded BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE person_ext ALTER COLUMN tipo DROP NOT NULL;

DROP VIEW IF EXISTS professionisti_v;
CREATE VIEW professionisti_v AS
  SELECT p.id, p.last_name || ' ' || p.first_name AS nome, p.last_name, p.first_name, p.kind, p.status, p.title,
         COALESCE(e.tipo, CASE WHEN p.kind = 'MEDICO' OR (p.kind = 'LP' AND coalesce(p.discipline, '') <> '') THEN 'medico' ELSE 'sanitario' END) AS tipo,
         COALESCE(e.profilo, NULLIF(p.job_title, ''), CASE WHEN p.kind = 'MEDICO' THEN 'Medico' END) AS profilo,
         p.email, p.phone, p.phone_office, p.tax_code, p.discipline, p.job_title, p.sex, p.birth_date, p.site_id,
         (p.status IN ('ATTIVO', 'IMPEGNO')) AS attivo,
         COALESCE(e.dati, '{}'::jsonb) AS dati,
         (e.tipo IS NOT NULL) AS in_room, e.created_at, e.updated_at, e.updated_by,
         s.name AS site_name, p.role_id, r.name AS role_name,
         COALESCE(e.planning_excluded, FALSE) AS planning_excluded,
         (p.status IN ('ATTIVO', 'IMPEGNO') AND NOT COALESCE(e.planning_excluded, FALSE)) AS pianificabile
    FROM public.people p
    LEFT JOIN person_ext e ON e.person_id = p.id
    LEFT JOIN public.sites s ON s.id = p.site_id
    LEFT JOIN public.job_roles r ON r.id = p.role_id;
