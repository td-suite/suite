-- Impostazioni senza doppia compilazione (richiesta del CEO, 27/10/2026, docs/IMPOSTAZIONI.md). La scheda Room del
-- professionista (person_ext.dati->'anagrafica') non duplica più i dati personali dell'anagrafica unica (migrazione core 018):
-- luogo di nascita, partita IVA e residenza (via, CAP, città, provincia) sono public.people.birth_place, vat_number, address,
-- zip, city, province. I valori esistenti completano il core dove manca, poi le chiavi spariscono dal JSON; la vista
-- professionisti_v li espone dal core. Restano nella scheda Room: PEC, IBAN, intestatario del conto, contatto di emergenza.
UPDATE public.people p SET
  birth_place = coalesce(p.birth_place, nullif(x.dati->'anagrafica'->>'luogoNascita', '')),
  vat_number  = coalesce(p.vat_number, nullif(x.dati->'anagrafica'->>'partitaIva', '')),
  address     = coalesce(p.address, nullif(x.dati->'anagrafica'->>'indirizzo', '')),
  zip         = coalesce(p.zip, nullif(x.dati->'anagrafica'->>'cap', '')),
  city        = coalesce(p.city, nullif(x.dati->'anagrafica'->>'citta', '')),
  province    = coalesce(p.province, nullif(x.dati->'anagrafica'->>'provincia', '')),
  updated_at  = now()
  FROM person_ext x WHERE x.person_id = p.id AND jsonb_typeof(x.dati->'anagrafica') = 'object';
UPDATE person_ext SET dati = jsonb_set(dati, '{anagrafica}', (dati->'anagrafica') - 'luogoNascita' - 'partitaIva' - 'indirizzo' - 'cap' - 'citta' - 'provincia'), updated_at = now()
 WHERE jsonb_typeof(dati->'anagrafica') = 'object';

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
         (p.status IN ('ATTIVO', 'IMPEGNO') AND NOT COALESCE(e.planning_excluded, FALSE)) AS pianificabile
    FROM public.people p
    LEFT JOIN person_ext e ON e.person_id = p.id
    LEFT JOIN public.sites s ON s.id = p.site_id
    LEFT JOIN public.job_roles r ON r.id = p.role_id;
