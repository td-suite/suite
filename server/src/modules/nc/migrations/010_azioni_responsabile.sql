-- Non conformità v0.93.0 (CEO, 21/11/2026): il responsabile di un'azione correttiva o preventiva si sceglie dall'elenco del personale
-- (dipendenti e liberi professionisti) e trova l'azione fra le sue cose da fare ("Le mie azioni" nel widget NC), dove ne aggiorna lo
-- stato. Il campo di testo `responsabile` resta: porta il nome scelto e i nomi scritti a mano prima di questa versione.
-- Profilo implicito AZIONI: chi ha azioni assegnate e nessun profilo sul widget entra solo in "Le mie azioni". Idempotente.
ALTER TABLE nc_azioni ADD COLUMN IF NOT EXISTS responsabile_person_id INT REFERENCES public.people(id) ON DELETE SET NULL;
ALTER TABLE nc_azioni ADD COLUMN IF NOT EXISTS assegnata_at TIMESTAMPTZ;          -- quando il responsabile è stato avvisato
ALTER TABLE nc_azioni ADD COLUMN IF NOT EXISTS resp_nota TEXT;                    -- ultimo aggiornamento scritto dal responsabile
ALTER TABLE nc_azioni ADD COLUMN IF NOT EXISTS resp_aggiornata_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS nc_azioni_resp_idx ON nc_azioni (responsabile_person_id) WHERE responsabile_person_id IS NOT NULL;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('ADMIN','QUALITA','LAB','SEDE','VIEWER','AZIONI'));
