-- Vertice: una persona può non dipendere da nessuno, anche se l'organigramma suggerirebbe un responsabile
ALTER TABLE people ADD COLUMN IF NOT EXISTS no_manager BOOLEAN NOT NULL DEFAULT FALSE;
CREATE OR REPLACE FUNCTION people_manager(pid INT) RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN (SELECT no_manager FROM people WHERE id = pid) THEN NULL
              ELSE coalesce((SELECT manager_person_id FROM people WHERE id = pid), people_manager_auto(pid)) END;
$$;
