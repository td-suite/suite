-- v0.67.1 (decisioni del CEO del 09/11/2026 sera): profilo dei pazienti del laboratorio in Retail dai dati Synclab (proiezione standard,
-- nessuna identità) e recupero puntuale del paziente per le Non conformità. Migrazione idempotente e NON distruttiva.
--  1. public.geo_comuni: cache della geocodifica dei comuni di provenienza (lib/geocode.js) per la mappa a bolle del profilo. Una riga
--     per (comune, provincia) normalizzati; esito NON_TROVATO conservato per non ripetere la ricerca. Nessun dato personale: solo il nome
--     del comune e le sue coordinate.
--  2. indici per la ricerca puntuale dell'accettazione nella copia Synclab (numero di accettazione, barcode del campione) e per le
--     aggregazioni del profilo per data.
CREATE TABLE IF NOT EXISTS public.geo_comuni (
  comune_norm    TEXT NOT NULL,
  provincia_norm TEXT NOT NULL DEFAULT '',
  comune         TEXT NOT NULL,
  provincia      TEXT,
  lat            NUMERIC(9,6),
  lng            NUMERIC(9,6),
  precision      TEXT,
  source         TEXT,
  label          TEXT,
  esito          TEXT NOT NULL DEFAULT 'OK' CHECK (esito IN ('OK','NON_TROVATO','ERRORE')),
  tentato_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (comune_norm, provincia_norm)
);

CREATE INDEX IF NOT EXISTS requests_number_idx ON synclab.requests (request_number);
CREATE INDEX IF NOT EXISTS samples_barcode_idx ON synclab.samples (barcode);
CREATE INDEX IF NOT EXISTS request_items_req_idx ON synclab.request_items (instance_id, request_id);

INSERT INTO audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', '053_profilo_pazienti.sql', 'Profilo pazienti (Synclab, proiezione standard): cache dei comuni geocodificati e indici di ricerca puntuale',
       jsonb_build_object('comuni_in_cache', (SELECT count(*) FROM public.geo_comuni))
WHERE NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'MIGRAZIONE_RAPPORTO' AND entity_id = '053_profilo_pazienti.sql');
