-- Ricerca prospect (v0.76.0): registro imprese (Openapi), Google Places (solo identificativo del luogo), raccolta notturna da OpenStreetMap
ALTER TABLE scout_candidati DROP CONSTRAINT IF EXISTS scout_candidati_fonte_check;
ALTER TABLE scout_candidati ADD CONSTRAINT scout_candidati_fonte_check CHECK (fonte IN ('OSM','MANUALE','ACCOUNT','MINISTERO','ELENCO','REGISTRO','GOOGLE'));
CREATE TABLE IF NOT EXISTS scout_osm_stato (
  provincia      TEXT NOT NULL,
  categoria      TEXT NOT NULL,
  ultimo_ok_at   TIMESTAMPTZ,
  tentativo_at   TIMESTAMPTZ,
  errore         TEXT,
  strutture      INT,
  PRIMARY KEY (provincia, categoria)
);
