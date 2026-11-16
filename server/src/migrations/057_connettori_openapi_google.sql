-- Connettori per la Ricerca prospect del Business Hub (v0.76.0, CEO 16/11/2026): Openapi Company (registro imprese per codice attività,
-- www.ufficiocamerale.it) e Google Places. Chiavi cifrate come per gli altri connettori. Idempotente.
ALTER TABLE public.connectors DROP CONSTRAINT IF EXISTS connectors_kind_check;
ALTER TABLE public.connectors ADD CONSTRAINT connectors_kind_check CHECK (kind IN ('STUDIOLAB','GIPO','TUOTEMPO','SILVA','OPENAPI','GOOGLE'));
INSERT INTO public.connectors (kind, name, base_url, auth_kind, settings) VALUES
  ('OPENAPI', 'Openapi Company (registro imprese)', 'https://company.openapi.com', 'API_KEY', '{"max_imprese":300}'),
  ('GOOGLE',  'Google Places',                      'https://places.googleapis.com', 'API_KEY', '{}')
ON CONFLICT (kind) DO NOTHING;
