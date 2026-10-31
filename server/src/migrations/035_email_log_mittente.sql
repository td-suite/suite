-- Registro delle email: mittente dell'invio. Di norma è la casella della Suite (suite@); alcuni moduli scrivono da una casella
-- propria (Contracts: people@toscanadiagnostica.it per i richiami sulle scadenze), che deve avere Mail.Send sull'app registration.
ALTER TABLE email_log ADD COLUMN IF NOT EXISTS from_addr TEXT;
