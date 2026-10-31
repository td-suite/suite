-- Magazzino Centrale e Dotazione di avvio delle sedi (richiesta del CEO, 31/10/2026).
--
-- 1. Visibilità degli articoli a quattro tipologie di struttura: Punti Prelievo (visible_sedi), Centro Polidiagnostico (visible_poli,
--    nuova), Laboratorio di Analisi (visible_lab, nuova), Service (visible_service), più "Tutti" (visible_all). Finora la casella
--    "Punti prelievo e laboratorio" (visible_sedi) valeva per tutte le sedi TD: le due colonne nuove partono dallo stesso valore.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS visible_poli BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE articles ADD COLUMN IF NOT EXISTS visible_lab BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE articles SET visible_poli = visible_sedi, visible_lab = visible_sedi;

-- 2. Modelli di dotazione per tipologia: l'elenco completo del materiale di avvio (articoli del catalogo Silva, confezioni, note).
--    Le tipologie sono quattro e fisse; POLIDIAGNOSTICO copre i tipi di sede CENTRO_DIAGNOSTICO, POLIAMBULATORIO e CENTRO_MEDICO,
--    SERVICE le Legal entity (clienti service e partner).
CREATE TABLE startup_templates (
  kind        TEXT PRIMARY KEY CHECK (kind IN ('PUNTO_PRELIEVI','POLIDIAGNOSTICO','LABORATORIO','SERVICE')),
  name        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  INT REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO startup_templates (kind, name) VALUES
  ('PUNTO_PRELIEVI', 'Punto Prelievi'),
  ('POLIDIAGNOSTICO', 'Centro Polidiagnostico'),
  ('LABORATORIO', 'Laboratorio di Analisi'),
  ('SERVICE', 'Cliente service / Legal entity');

CREATE TABLE startup_template_lines (
  id          SERIAL PRIMARY KEY,
  kind        TEXT NOT NULL REFERENCES startup_templates(kind) ON DELETE CASCADE,
  article_id  INT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  packs       INT NOT NULL CHECK (packs > 0),
  note        TEXT,
  sort        INT NOT NULL DEFAULT 0,
  UNIQUE (kind, article_id)
);

-- 3. Dotazione della singola struttura. Chiave struttura_id come nel resto del modulo (vista strutture_v): > 0 sede di
--    public.sites, < 0 opposto dell'id della Legal entity; site_id e org_id generati portano le chiavi esterne reali.
--    La data di effettiva apertura delle sedi è public.sites.opened_at (anagrafica unica); per le Legal entity, che non
--    hanno una data di apertura nel core, è la data di avvio del rapporto (start_date, modificabile dalla sezione).
CREATE TABLE startup_loads (
  id            SERIAL PRIMARY KEY,
  struttura_id  INT NOT NULL UNIQUE CHECK (struttura_id <> 0),
  site_id       INT GENERATED ALWAYS AS (CASE WHEN struttura_id > 0 THEN struttura_id END) STORED REFERENCES public.sites(id),
  org_id        INT GENERATED ALWAYS AS (CASE WHEN struttura_id < 0 THEN -struttura_id END) STORED REFERENCES public.organizations(id),
  kind          TEXT NOT NULL CHECK (kind IN ('PUNTO_PRELIEVI','POLIDIAGNOSTICO','LABORATORIO','SERVICE')),
  status        TEXT NOT NULL DEFAULT 'NON_PIANIFICATA' CHECK (status IN ('NON_PIANIFICATA','PIANIFICATA','CONSEGNATA')),
  start_date    DATE,                                   -- solo Legal entity: data di avvio del rapporto
  planned_at    TIMESTAMPTZ,
  planned_by    INT REFERENCES users(id) ON DELETE SET NULL,
  order_id      INT REFERENCES orders(id) ON DELETE SET NULL,   -- ordine facoltativo al Magazzino Centrale
  delivered_at  TIMESTAMPTZ,                            -- data della Giacenza 0 (received_at delle confezioni)
  delivered_by  INT REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE startup_load_lines (
  id              SERIAL PRIMARY KEY,
  load_id         INT NOT NULL REFERENCES startup_loads(id) ON DELETE CASCADE,
  article_id      INT NOT NULL REFERENCES articles(id),
  packs_planned   INT NOT NULL DEFAULT 0 CHECK (packs_planned >= 0),
  packs_delivered INT CHECK (packs_delivered >= 0),
  lot             TEXT,
  expiry          DATE,
  note            TEXT,
  sort            INT NOT NULL DEFAULT 0,
  UNIQUE (load_id, article_id)
);

-- 4. Giacenza 0 = confezioni in packages con origin 'INIZIALE' e stato RICEVUTO (stessa logica del carico iniziale di
--    routes/stock.js); il riferimento al carico permette di annullarla togliendo solo le confezioni ancora in giacenza.
ALTER TABLE packages ADD COLUMN IF NOT EXISTS startup_load_id INT REFERENCES startup_loads(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS packages_startup_idx ON packages (startup_load_id) WHERE startup_load_id IS NOT NULL;
