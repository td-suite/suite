-- Finance Management, "Controllo di gestione" (programma "anagrafica unica", decisioni 11 e 12, CEO 08/11/2026): conto economico di sede
-- (P&L) e margine per cliente Service. Migrazione idempotente e NON distruttiva: colonne e tabelle nuove, nessuna riga cancellata,
-- nessun valore già presente sovrascritto (cost_center resta com'è: fa parte del contenuto firmato delle istanze). Rapporto in
-- public.audit_log (MIGRAZIONE_RAPPORTO). Docs: docs/FINANCE.md.

-- 1. Istanze di pagamento: sede / centro di costo e cliente (facoltativi) per il conto economico. Non entrano nell'impronta del contenuto
--    firmato (rules.js SIGNED_FIELDS): si possono classificare anche le istanze già firmate o eseguite senza toccare le firme.
--    pl_escluso: pagamento già contato in un'altra riga del conto economico (stipendi e contributi, canoni e bollette dello
--    Scadenziario, rate di finanziamenti, imposte) o comunque fuori dal conto economico di sede.
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS site_id INT REFERENCES public.sites(id) ON DELETE SET NULL;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS org_id INT REFERENCES public.organizations(id) ON DELETE SET NULL;
ALTER TABLE payment_requests ADD COLUMN IF NOT EXISTS pl_escluso BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS payment_requests_site_idx ON payment_requests (site_id) WHERE site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_requests_org_idx ON payment_requests (org_id) WHERE org_id IS NOT NULL;

-- 2. Abbinamento del centro di costo testuale alle sedi (per nome, nome breve o codice; anche solo la prima parte del testo prima di
--    " · ", " - ", ":" o "/"), solo dove site_id è vuoto e la sede riconosciuta è una sola. I testi non riconosciuti o ambigui restano
--    da classificare a mano nella scheda dell'istanza (elenco nel rapporto). Separatori: "·" e ":" sempre, "-", "–" e "/" solo con gli
--    spazi intorno (un codice come FI-CEC resta intero).
CREATE TEMP TABLE _m006_cc ON COMMIT DROP AS
  SELECT r.id, lower(btrim(r.cost_center)) AS t1,
         lower(btrim(split_part(regexp_replace(r.cost_center, '\s*[·:]\s*|\s+[–/-]\s+', '|', 'g'), '|', 1))) AS t2
    FROM payment_requests r
   WHERE r.site_id IS NULL AND coalesce(btrim(r.cost_center), '') <> '';
CREATE TEMP TABLE _m006_match ON COMMIT DROP AS
  SELECT c.id, (array_agg(DISTINCT s.id))[1] AS site_id, count(DISTINCT s.id) AS n
    FROM _m006_cc c JOIN public.sites s
      ON c.t1 IN (lower(s.name), lower(coalesce(s.short_name, '')), lower(s.code))
      OR (c.t2 <> '' AND c.t2 IN (lower(s.name), lower(coalesce(s.short_name, '')), lower(s.code)))
   GROUP BY c.id;
UPDATE payment_requests r SET site_id = m.site_id FROM _m006_match m WHERE m.id = r.id AND m.n = 1 AND r.site_id IS NULL;

-- 3. Produzione Service per cliente e mese, quando StudioLAB non arriva alla Suite (né dalle vendite B2B di Retail né dalla produzione
--    di Ordini): inserimento manuale o da XLSX nella pagina "Margine per cliente Service", stima dall'account del Business Hub salvata.
--    righe: dettaglio per esame [{ codice, descrizione, quantita }] quando il file lo porta (ricavo ai prezzi del listino del cliente).
CREATE TABLE IF NOT EXISTS produzione_service (
  id          SERIAL PRIMARY KEY,
  org_id      INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mese        DATE NOT NULL CHECK (mese = date_trunc('month', mese)::date),
  esami       INT NOT NULL DEFAULT 0 CHECK (esami >= 0),
  valore      NUMERIC(14,2) CHECK (valore IS NULL OR valore >= 0),
  fonte       TEXT NOT NULL DEFAULT 'MANUALE' CHECK (fonte IN ('STUDIOLAB','MANUALE','STIMA')),
  righe       JSONB,
  note        TEXT,
  created_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, mese)
);
CREATE INDEX IF NOT EXISTS produzione_service_mese_idx ON produzione_service (mese);

-- 4. Costo analitico per esame (Impostazioni > Controllo di gestione, caricamento XLSX "costi esami": codice, descrizione, costo)
CREATE TABLE IF NOT EXISTS costi_esami (
  codice      TEXT PRIMARY KEY,                -- codice esame (maiuscolo, come nel listino StudioLAB)
  descrizione TEXT,
  costo       NUMERIC(12,4) NOT NULL CHECK (costo >= 0),
  updated_by  INT REFERENCES users(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Rapporto
INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'finance/006_controllo_gestione.sql', 'Finance Management: sede e cliente delle istanze, produzione Service, costi esami',
       jsonb_build_object(
         'istanze', (SELECT count(*) FROM payment_requests),
         'istanze_con_centro_di_costo', (SELECT count(*) FROM payment_requests WHERE coalesce(btrim(cost_center), '') <> ''),
         'abbinate_a_una_sede', (SELECT count(*) FROM _m006_match m JOIN payment_requests r ON r.id = m.id WHERE m.n = 1 AND r.site_id = m.site_id),
         'ambigue_piu_sedi', (SELECT count(*) FROM _m006_match WHERE n > 1),
         'non_riconosciute', (SELECT count(*) FROM _m006_cc c WHERE NOT EXISTS (SELECT 1 FROM _m006_match m WHERE m.id = c.id)),
         'testi_da_classificare', (SELECT coalesce(jsonb_agg(t ORDER BY t), '[]'::jsonb) FROM (
             SELECT DISTINCT r.cost_center AS t FROM payment_requests r JOIN _m006_cc c ON c.id = r.id
              WHERE r.site_id IS NULL LIMIT 50) x));
