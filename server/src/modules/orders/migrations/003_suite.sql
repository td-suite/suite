-- Suite TD: la tabella users del modulo viene popolata dalla Suite al primo accesso di ogni utente (email, nome, ruolo).
-- La struttura dei profili CLIENTE/SEDE/LAB arriva dagli ambiti del grant Suite (sites.legacy_refs → strutture.id) e viene
-- scritta subito dopo: il vincolo "struttura obbligatoria per i profili di struttura" non può valere al momento dell'inserimento.
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint WHERE conrelid = 'users'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%struttura_id%' LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
-- La password non serve più (autenticazione della Suite): il campo resta per compatibilità con le righe travasate
ALTER TABLE users ALTER COLUMN must_change_password SET DEFAULT FALSE;
