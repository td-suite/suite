-- Presa visione per utente delle circolari pubblicate (01/11/2026, "Il mio spazio" del Portale Service): chi è nel perimetro della
-- circolare la conferma dal widget; il Portale Service conta le circolari del segmento Clienti service ancora da leggere.
-- user_id è l'utente della Suite (public.users), non la riga tecnica del modulo.
CREATE TABLE IF NOT EXISTS prese_visione (
  circolare_id  INT NOT NULL REFERENCES circolari(id) ON DELETE CASCADE,
  user_id       INT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (circolare_id, user_id)
);
CREATE INDEX IF NOT EXISTS prese_visione_user ON prese_visione (user_id);
