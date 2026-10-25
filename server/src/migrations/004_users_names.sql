-- Cognome e nome separati sugli utenti: la Suite mostra ovunque "Cognome Nome" (full_name resta la forma visualizzata, ricalcolata).
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT, ADD COLUMN IF NOT EXISTS last_name TEXT;

-- 1) utenti collegati a una persona dell'anagrafica (o con la stessa email): nomi dalla persona
UPDATE users u SET first_name = p.first_name, last_name = p.last_name
FROM people p
WHERE u.first_name IS NULL AND (u.person_id = p.id OR (u.person_id IS NULL AND lower(p.email) = lower(u.email)));

-- 2) gli altri: full_name "Nome Cognome" spezzato sull'ultima parola (ipotesi: cognome = ultima parola; correggibile da Amministrazione > Utenti)
UPDATE users SET
  first_name = CASE WHEN full_name ~ '\s' THEN regexp_replace(full_name, '\s+\S+$', '') ELSE full_name END,
  last_name  = CASE WHEN full_name ~ '\s' THEN regexp_replace(full_name, '^.*\s', '') ELSE '' END
WHERE first_name IS NULL AND full_name IS NOT NULL AND full_name <> email;

UPDATE users SET first_name = '', last_name = '' WHERE first_name IS NULL;

-- forma visualizzata: Cognome Nome
UPDATE users SET full_name = btrim(coalesce(last_name,'') || ' ' || coalesce(first_name,'')) WHERE btrim(coalesce(last_name,'') || ' ' || coalesce(first_name,'')) <> '';
