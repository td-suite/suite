-- Moduli aperti a tutti gli utenti autenticati (Ticket): widget in home e accesso senza grant, con il ruolo implicito del modulo.
ALTER TABLE modules ADD COLUMN IF NOT EXISTS open_to_all BOOLEAN NOT NULL DEFAULT FALSE;
