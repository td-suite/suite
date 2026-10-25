-- Responsabile calcolato dal solo organigramma (senza la forzatura manuale), per mostrarlo accanto all'override nella scheda persona
CREATE OR REPLACE FUNCTION people_manager_auto(pid INT) RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT op2.person_id
    FROM org_positions op
    JOIN org_units u ON u.id = op.unit_id
    JOIN org_positions op2 ON op2.is_head AND op2.person_id <> pid
                          AND op2.unit_id = CASE WHEN op.is_head THEN u.parent_id ELSE op.unit_id END
   WHERE op.person_id = pid
   ORDER BY op.is_head DESC, op.sort_order, op.id, op2.id
   LIMIT 1;
$$;
CREATE OR REPLACE FUNCTION people_manager(pid INT) RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT coalesce((SELECT manager_person_id FROM people WHERE id = pid), people_manager_auto(pid));
$$;
