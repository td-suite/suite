-- 09/11/2026 (CEO): i referenti esterni dei clienti service e dei fornitori non sono professionisti. Una persona di tipo ESTERNO
-- compare in Personale sanitario (ed è pianificabile) solo se ha una disciplina, un ruolo sanitario o una scheda Room compilata.
-- Si ricrea la vista con la stessa struttura di 007 più la colonna professionista. Idempotente.
DROP VIEW IF EXISTS professionisti_v;
CREATE VIEW professionisti_v AS
  SELECT p.id, p.last_name || ' ' || p.first_name AS nome, p.last_name, p.first_name, p.kind, p.status, p.title,
         COALESCE(e.tipo, CASE WHEN p.kind = 'MEDICO' OR (p.kind = 'LP' AND coalesce(p.discipline, '') <> '') THEN 'medico' ELSE 'sanitario' END) AS tipo,
         COALESCE(e.profilo, NULLIF(p.job_title, ''), CASE WHEN p.kind = 'MEDICO' THEN 'Medico' END) AS profilo,
         p.email, p.phone, p.phone_office, p.tax_code, p.discipline, p.job_title, p.sex, p.birth_date, p.site_id,
         p.birth_place, p.vat_number, p.address, p.zip, p.city, p.province,
         (p.status IN ('ATTIVO', 'IMPEGNO')) AS attivo,
         COALESCE(e.dati, '{}'::jsonb) AS dati,
         (e.tipo IS NOT NULL) AS in_room, e.created_at, e.updated_at, e.updated_by,
         s.name AS site_name, p.role_id, r.name AS role_name,
         COALESCE(e.planning_excluded, FALSE) AS planning_excluded,
         (p.kind <> 'ESTERNO' OR e.tipo IS NOT NULL OR coalesce(p.discipline, '') <> ''
            OR coalesce(r.name, '') ~* '(medic|sanitar|infermier|ostetric|fisioterap|biolog|psicolog|dietist|logoped|radiolog|laborator|tsrm|tslb|\moss\M|prelev|assistente sanitari)') AS professionista,
         (p.status IN ('ATTIVO', 'IMPEGNO') AND NOT COALESCE(e.planning_excluded, FALSE)
            AND (p.kind <> 'ESTERNO' OR e.tipo IS NOT NULL OR coalesce(p.discipline, '') <> ''
                 OR coalesce(r.name, '') ~* '(medic|sanitar|infermier|ostetric|fisioterap|biolog|psicolog|dietist|logoped|radiolog|laborator|tsrm|tslb|\moss\M|prelev|assistente sanitari)')) AS pianificabile
    FROM public.people p
    LEFT JOIN person_ext e ON e.person_id = p.id
    LEFT JOIN public.sites s ON s.id = p.site_id
    LEFT JOIN public.job_roles r ON r.id = p.role_id;
