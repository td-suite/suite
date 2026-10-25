-- Afferenza: una persona appartiene a un'unità qualunque dell'albero (reparto, funzione, sede, area, direzione).
-- org_unit_path: percorso leggibile dalla Direzione all'unità (Direzione › B2B › Service di Laboratorio); org_unit_site: la sede
-- dell'unità o del primo antenato che ne ha una.
CREATE OR REPLACE FUNCTION org_unit_path(uid INT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT id, name, parent_id, 0 AS depth FROM org_units WHERE id = uid
    UNION ALL
    SELECT u.id, u.name, u.parent_id, up.depth + 1 FROM org_units u JOIN up ON u.id = up.parent_id WHERE up.depth < 12
  )
  SELECT string_agg(name, ' › ' ORDER BY depth DESC) FROM up;
$$;
CREATE OR REPLACE FUNCTION org_unit_site(uid INT) RETURNS INT LANGUAGE sql STABLE AS $$
  WITH RECURSIVE up AS (
    SELECT id, site_id, parent_id, 0 AS depth FROM org_units WHERE id = uid
    UNION ALL
    SELECT u.id, u.site_id, u.parent_id, up.depth + 1 FROM org_units u JOIN up ON u.id = up.parent_id WHERE up.depth < 12
  )
  SELECT site_id FROM up WHERE site_id IS NOT NULL ORDER BY depth LIMIT 1;
$$;
