-- v0.68.4 (CEO, 10/11/2026: "l'impegno assegnato in Sedi e ambulatori non viene riportato in calendario, turni, presenze"). Chi è nel
-- personale di una sede con la persona dell'anagrafica scelta (person_id della riga, PersonaPicker dalla v0.67.3) riceve la scheda Room
-- se non l'ha: tipo dal gruppo della riga (medico → medico; personale sanitario e accettazione → sanitario), la sede tra le sedi
-- abilitate. Solo persone attive e non escluse dalla pianificazione; chi ha già la scheda non si tocca. Da qui in avanti lo fa il
-- salvataggio della sede (routes/strutture.js) e la generazione dei turni. Idempotente (ripetuta non crea né cambia nulla).
WITH righe AS (
  SELECT e.site_id, x->>'tipo' AS tipo, nullif(x->>'profilo', '') AS profilo, (x->>'person_id')::int AS person_id,
         row_number() OVER (PARTITION BY (x->>'person_id')::int ORDER BY CASE x->>'tipo' WHEN 'medico' THEN 0 WHEN 'sanitario' THEN 1 ELSE 2 END, e.site_id) AS n
    FROM site_ext e
    JOIN public.sites s ON s.id = e.site_id AND s.active
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(e.data->'personale') = 'array' THEN e.data->'personale' ELSE '[]'::jsonb END) x
   WHERE coalesce(x->>'person_id', '') ~ '^[0-9]+$' AND x->>'tipo' IN ('medico', 'sanitario', 'accettazione')
     AND trim(coalesce(x->>'nome', '')) <> ''
     AND trim(x->>'nome') !~* '^(punto prelievi|rm |rx|mammograf|tc\M|moc|opt|seminolog|anatomia patolog|medicina del lavoro)'
), scelte AS (
  SELECT r.person_id, CASE WHEN r.tipo = 'medico' THEN 'medico' ELSE 'sanitario' END AS tipo,
         coalesce(r.profilo, CASE r.tipo WHEN 'accettazione' THEN 'Accettazione' WHEN 'medico' THEN 'Medico' END) AS profilo,
         jsonb_build_object('sediAbilitate', (SELECT jsonb_agg(DISTINCT r2.site_id) FROM righe r2 WHERE r2.person_id = r.person_id),
                            'compenso', jsonb_build_object('tipo', 'ORARIO'), 'origine', 'personale di sede (migrazione room 014)') AS dati
    FROM righe r
    JOIN public.people p ON p.id = r.person_id AND p.status IN ('ATTIVO', 'IMPEGNO')
   WHERE r.n = 1
)
INSERT INTO person_ext (person_id, tipo, profilo, dati)
SELECT s.person_id, s.tipo, s.profilo, s.dati FROM scelte s
ON CONFLICT (person_id) DO UPDATE SET tipo = EXCLUDED.tipo, profilo = coalesce(person_ext.profilo, EXCLUDED.profilo), dati = person_ext.dati || EXCLUDED.dati, updated_at = now()
 WHERE person_ext.tipo IS NULL AND NOT person_ext.planning_excluded;
