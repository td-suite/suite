-- Connettori: autenticazione CLIENT_JWT (StudioLAB WebApi di CB Sistemi, istruzioni del 08/11/2026): registrazione della password del
-- client una tantum, login con name+password che restituisce un token JWT con scadenza, Bearer su ogni chiamata. Idempotente.
ALTER TABLE public.connectors DROP CONSTRAINT IF EXISTS connectors_auth_kind_check;
ALTER TABLE public.connectors ADD CONSTRAINT connectors_auth_kind_check CHECK (auth_kind IN ('API_KEY','BASIC','OAUTH2','NONE','CLIENT_JWT'));
