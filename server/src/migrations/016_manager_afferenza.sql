-- Il responsabile deriva prima dall'afferenza (people.unit_id): il responsabile di quell'unità, o dell'unità superiore se la persona
-- è lei stessa la responsabile; solo in mancanza di afferenza si guardano gli incarichi. Chi ha incarichi ma non afferenza la riceve.
CREATE OR REPLACE FUNCTION people_manager_auto(pid INT) RETURNS INT LANGUAGE sql STABLE AS $$
  SELECT coalesce(
    (SELECT op2.person_id
       FROM people p JOIN org_units u ON u.id = p.unit_id
       JOIN org_positions op2 ON op2.is_head AND op2.person_id <> pid
                             AND op2.unit_id = CASE WHEN EXISTS (SELECT 1 FROM org_positions h WHERE h.unit_id = u.id AND h.person_id = pid AND h.is_head) THEN u.parent_id ELSE u.id END
      WHERE p.id = pid ORDER BY op2.sort_order, op2.id LIMIT 1),
    (SELECT op2.person_id
       FROM org_positions op JOIN org_units u ON u.id = op.unit_id
       JOIN org_positions op2 ON op2.is_head AND op2.person_id <> pid
                             AND op2.unit_id = CASE WHEN op.is_head THEN u.parent_id ELSE op.unit_id END
      WHERE op.person_id = pid ORDER BY op.is_head DESC, op.sort_order, op.id, op2.id LIMIT 1));
$$;
UPDATE people p SET unit_id = (SELECT op.unit_id FROM org_positions op JOIN org_units u ON u.id=op.unit_id WHERE op.person_id = p.id
  ORDER BY (u.kind IN ('REPARTO','FUNZIONE')) DESC, op.is_head DESC, op.sort_order, op.id LIMIT 1)
  WHERE p.unit_id IS NULL AND EXISTS (SELECT 1 FROM org_positions op WHERE op.person_id = p.id);
