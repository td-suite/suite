-- Piano Ferie: funzionamento stabilito dal CEO (08/11/2026). "Solo l'amministratore (il CEO) vede tutto. Ogni dipendente vede solo la
-- propria area. Il dipendente inserisce il piano ferie annuale. Il responsabile dell'Area (approvatore) può modificare il piano dei
-- dipendenti dell'area e poi approvarlo e renderlo definito." Il modulo passa dalle richieste singole al PIANO ANNUALE per persona e anno,
-- trasparente a tutta l'area e solo all'area.
--
-- Migrazione idempotente e non distruttiva (la Suite è in produzione):
-- 1. tabella ferie.piani (un piano per persona e anno) e cronologia ferie.piano_eventi;
-- 2. ferie.richieste diventa la tabella dei PERIODI del piano: colonna piano_id, stato PIANIFICATA (periodo di un piano non ancora
--    approvato), variazione (periodo proposto come variazione dopo l'approvazione), variazione_proposta (spostamento o rimozione di un
--    periodo approvato in attesa di decisione); i vincoli di stato si allargano, nessun valore esistente viene tolto;
-- 3. un piano per ogni dipendente del perimetro (DIPENDENTE, e DIRIGENTE salvo impostazione includi_dirigenti = false, ATTIVO, con
--    contratto in contracts.employments) per l'anno corrente e il prossimo, più un piano per ogni persona e anno che ha già richieste;
-- 4. le richieste esistenti si agganciano al piano: APPROVATA e GODUTA restano periodi approvati; RICHIESTA in attesa diventa periodo
--    proposto (PIANIFICATA); RIFIUTATA e ANNULLATA restano come storico. Il piano nasce BOZZA, o APPROVATO se tutte le sue richieste
--    attive erano approvate (almeno una);
-- 5. rapporto in public.audit_log (MIGRAZIONE_RAPPORTO) con i conteggi.
-- Nessun dato inventato: date e decisori delle approvazioni vengono dalle richieste (deciso_at, deciso_da_user_id).

-- 1. Piani annuali -------------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS piani (
  id                    SERIAL PRIMARY KEY,
  person_id             INT NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  anno                  INT NOT NULL CHECK (anno BETWEEN 2000 AND 2100),
  -- BOZZA (il dipendente lo compila) → PROPOSTO (inviato all'approvatore) → IN_REVISIONE (l'approvatore lo sta modificando)
  -- → APPROVATO (ancora modificabile dall'approvatore) → DEFINITIVO (bloccato: cambiano i periodi solo l'approvatore o HR, con motivo)
  stato                 TEXT NOT NULL DEFAULT 'BOZZA' CHECK (stato IN ('BOZZA','PROPOSTO','IN_REVISIONE','APPROVATO','DEFINITIVO')),
  versione              INT NOT NULL DEFAULT 1,               -- cresce a ogni approvazione, definitivo, riapertura e variazione
  inviato_at            TIMESTAMPTZ,
  inviato_da            INT REFERENCES public.users(id) ON DELETE SET NULL,
  in_revisione_da       INT REFERENCES public.users(id) ON DELETE SET NULL,
  approvato_at          TIMESTAMPTZ,
  approvato_da          INT REFERENCES public.users(id) ON DELETE SET NULL,
  definitivo_at         TIMESTAMPTZ,
  definitivo_da         INT REFERENCES public.users(id) ON DELETE SET NULL,
  note                  TEXT NOT NULL DEFAULT '',             -- note del dipendente per l'approvatore
  nota_approvatore      TEXT,                                 -- ultima nota dell'approvatore (approvazione, riapertura)
  promemoria_at         TIMESTAMPTZ,                          -- ultimo promemoria del job (piano non inviato o in attesa)
  origine               TEXT NOT NULL DEFAULT 'APP' CHECK (origine IN ('APP','MIGRAZIONE')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (person_id, anno)
);
CREATE INDEX IF NOT EXISTS piani_anno_stato ON piani (anno, stato);
CREATE INDEX IF NOT EXISTS piani_inviato_da ON piani (inviato_da);
CREATE INDEX IF NOT EXISTS piani_in_revisione_da ON piani (in_revisione_da);
CREATE INDEX IF NOT EXISTS piani_approvato_da ON piani (approvato_da);
CREATE INDEX IF NOT EXISTS piani_definitivo_da ON piani (definitivo_da);

-- Cronologia del piano. user_id NULL = sistema (job, migrazione)
CREATE TABLE IF NOT EXISTS piano_eventi (
  id          SERIAL PRIMARY KEY,
  piano_id    INT NOT NULL REFERENCES piani(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('CREATO','MIGRATO','PERIODO_AGGIUNTO','PERIODO_MODIFICATO','PERIODO_TOLTO','INVIATO','IN_REVISIONE',
                'APPROVATO','DEFINITIVO','RIAPERTO','VARIAZIONE_PROPOSTA','VARIAZIONE_APPROVATA','VARIAZIONE_RIFIUTATA','VARIAZIONE','PROMEMORIA')),
  user_id     INT REFERENCES public.users(id) ON DELETE SET NULL,
  dati        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS piano_eventi_piano ON piano_eventi (piano_id, created_at);
CREATE INDEX IF NOT EXISTS piano_eventi_user ON piano_eventi (user_id);

-- 2. Periodi del piano nella tabella delle richieste ------------------------------------------------------------------------------
ALTER TABLE richieste ADD COLUMN IF NOT EXISTS piano_id INT REFERENCES piani(id) ON DELETE SET NULL;
ALTER TABLE richieste ADD COLUMN IF NOT EXISTS variazione BOOLEAN NOT NULL DEFAULT FALSE;          -- nato come variazione al piano approvato
ALTER TABLE richieste ADD COLUMN IF NOT EXISTS variazione_proposta JSONB;                           -- spostamento o rimozione in attesa
ALTER TABLE richieste ADD COLUMN IF NOT EXISTS modificata_da_user_id INT REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE richieste ADD COLUMN IF NOT EXISTS modificata_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS richieste_piano ON richieste (piano_id);
CREATE INDEX IF NOT EXISTS richieste_modificata ON richieste (modificata_da_user_id);
CREATE INDEX IF NOT EXISTS richieste_var_proposta ON richieste (piano_id) WHERE variazione_proposta IS NOT NULL;
-- stato PIANIFICATA: periodo di un piano non ancora approvato (BOZZA, PROPOSTO, IN_REVISIONE). Vincolo allargato, valori esistenti invariati.
ALTER TABLE richieste DROP CONSTRAINT IF EXISTS richieste_stato_check;
ALTER TABLE richieste ADD CONSTRAINT richieste_stato_check CHECK (stato IN ('PIANIFICATA','RICHIESTA','APPROVATA','RIFIUTATA','GODUTA','ANNULLATA'));
CREATE INDEX IF NOT EXISTS richieste_periodo_piano ON richieste (data_inizio, data_fine) WHERE stato IN ('PIANIFICATA','RICHIESTA','APPROVATA','GODUTA');
ALTER TABLE eventi DROP CONSTRAINT IF EXISTS eventi_tipo_check;
ALTER TABLE eventi ADD CONSTRAINT eventi_tipo_check CHECK (tipo IN ('RICHIESTA','APPROVATA','RIFIUTATA','GODUTA','ANNULLATA','PROMEMORIA','MODIFICA',
  'PIANIFICATA','VARIAZIONE_PROPOSTA','VARIAZIONE_APPROVATA','VARIAZIONE_RIFIUTATA','MIGRATA'));

-- 3. e 4. Piani dalle persone del perimetro e dalle richieste esistenti --------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS _f002 (voce TEXT PRIMARY KEY, dettaglio JSONB) ON COMMIT DROP;
CREATE TEMP TABLE IF NOT EXISTS _f002_nuovi (piano_id INT PRIMARY KEY) ON COMMIT DROP;
DO $$
DECLARE
  anno_c INT := extract(year FROM (now() AT TIME ZONE 'Europe/Rome'))::int;
  kinds TEXT[] := CASE WHEN coalesce((SELECT value FROM impostazioni WHERE key = 'includi_dirigenti'), 'true'::jsonb) = 'false'::jsonb
                       THEN ARRAY['DIPENDENTE'] ELSE ARRAY['DIPENDENTE','DIRIGENTE'] END;
  n INT;
BEGIN
  IF to_regclass('contracts.employments') IS NOT NULL THEN
    EXECUTE $q$
      WITH ins AS (
        INSERT INTO piani (person_id, anno, origine)
        SELECT DISTINCT p.id, a.anno, 'MIGRAZIONE'
          FROM public.people p JOIN contracts.employments e ON e.resource_id = p.id
          CROSS JOIN (VALUES ($1), ($1 + 1)) AS a(anno)
         WHERE p.status = 'ATTIVO' AND p.kind = ANY($2)
        ON CONFLICT (person_id, anno) DO NOTHING RETURNING id)
      INSERT INTO _f002_nuovi SELECT id FROM ins ON CONFLICT DO NOTHING$q$ USING anno_c, kinds;
    GET DIAGNOSTICS n = ROW_COUNT;
    INSERT INTO _f002 VALUES ('piani_creati_dal_perimetro', to_jsonb(n)) ON CONFLICT (voce) DO NOTHING;
  ELSE
    INSERT INTO _f002 VALUES ('perimetro', to_jsonb('Contratti del personale non avviato: nessun piano creato dal perimetro'::text)) ON CONFLICT (voce) DO NOTHING;
  END IF;
  -- persone e anni con richieste ma senza piano (anni passati, persone uscite dal perimetro): piano per lo storico
  WITH ins AS (
    INSERT INTO piani (person_id, anno, origine)
    SELECT DISTINCT r.person_id, r.anno, 'MIGRAZIONE' FROM richieste r
     WHERE NOT EXISTS (SELECT 1 FROM piani x WHERE x.person_id = r.person_id AND x.anno = r.anno)
    ON CONFLICT (person_id, anno) DO NOTHING RETURNING id)
  INSERT INTO _f002_nuovi SELECT id FROM ins ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  INSERT INTO _f002 VALUES ('piani_creati_dalle_richieste', to_jsonb(n)) ON CONFLICT (voce) DO NOTHING;
END $$;

-- conteggi delle richieste da agganciare, prima di toccarle
INSERT INTO _f002 SELECT 'richieste_da_agganciare', coalesce(jsonb_object_agg(stato, n), '{}'::jsonb)
  FROM (SELECT stato, count(*)::int AS n FROM richieste WHERE piano_id IS NULL GROUP BY stato) t ON CONFLICT (voce) DO NOTHING;

-- aggancio di ogni richiesta al piano della persona e dell'anno
UPDATE richieste r SET piano_id = p.id FROM piani p WHERE r.piano_id IS NULL AND p.person_id = r.person_id AND p.anno = r.anno;

-- RICHIESTA in attesa (ferie) → periodo proposto del piano (PIANIFICATA), con l'evento sulla richiesta. I permessi ROL restano richieste singole.
WITH conv AS (
  UPDATE richieste r SET stato = 'PIANIFICATA', updated_at = now()
   WHERE r.stato = 'RICHIESTA' AND r.tipo = 'FERIE' AND NOT r.variazione AND r.piano_id IN (SELECT piano_id FROM _f002_nuovi)
  RETURNING r.id)
INSERT INTO eventi (richiesta_id, tipo, user_id, dati) SELECT id, 'MIGRATA', NULL, '{"da":"RICHIESTA","a":"PIANIFICATA","nota":"richiesta in attesa diventata periodo proposto del piano annuale"}'::jsonb FROM conv;

-- stato del piano nuovo: APPROVATO se ha almeno una richiesta FERIE attiva e sono tutte approvate o godute; altrimenti BOZZA
WITH s AS (
  SELECT p.id,
         count(r.*) FILTER (WHERE r.tipo = 'FERIE' AND r.stato IN ('PIANIFICATA','RICHIESTA','APPROVATA','GODUTA')) AS attive,
         count(r.*) FILTER (WHERE r.tipo = 'FERIE' AND r.stato IN ('APPROVATA','GODUTA')) AS approvate,
         max(r.deciso_at) FILTER (WHERE r.tipo = 'FERIE' AND r.stato IN ('APPROVATA','GODUTA')) AS ultima
    FROM piani p JOIN _f002_nuovi n ON n.piano_id = p.id LEFT JOIN richieste r ON r.piano_id = p.id
   GROUP BY p.id)
UPDATE piani p SET stato = 'APPROVATO', approvato_at = s.ultima,
       approvato_da = (SELECT r.deciso_da_user_id FROM richieste r WHERE r.piano_id = p.id AND r.stato IN ('APPROVATA','GODUTA') AND r.tipo = 'FERIE' ORDER BY r.deciso_at DESC NULLS LAST, r.id DESC LIMIT 1)
  FROM s WHERE s.id = p.id AND s.attive > 0 AND s.attive = s.approvate AND p.stato = 'BOZZA';

INSERT INTO piano_eventi (piano_id, tipo, user_id, dati)
SELECT p.id, 'MIGRATO', NULL, jsonb_build_object('stato', p.stato, 'periodi', (SELECT count(*) FROM richieste r WHERE r.piano_id = p.id),
       'nota', 'Piano creato dalla migrazione 002 (dal perimetro o dalle richieste esistenti)')
  FROM piani p JOIN _f002_nuovi n ON n.piano_id = p.id;

-- 5. Rapporto ------------------------------------------------------------------------------------------------------------------
INSERT INTO _f002 SELECT 'piani_per_stato', coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
  FROM (SELECT anno || ' ' || stato AS k, count(*)::int AS n FROM piani p JOIN _f002_nuovi x ON x.piano_id = p.id GROUP BY anno, stato) t ON CONFLICT (voce) DO NOTHING;
INSERT INTO _f002 SELECT 'richieste_agganciate', to_jsonb((SELECT count(*)::int FROM richieste WHERE piano_id IN (SELECT piano_id FROM _f002_nuovi)))
  ON CONFLICT (voce) DO NOTHING;
INSERT INTO _f002 SELECT 'richieste_in_attesa_diventate_periodi_proposti', to_jsonb((SELECT count(*)::int FROM eventi WHERE tipo = 'MIGRATA'))
  ON CONFLICT (voce) DO NOTHING;
INSERT INTO _f002 SELECT 'richieste_senza_piano', to_jsonb((SELECT count(*)::int FROM richieste WHERE piano_id IS NULL)) ON CONFLICT (voce) DO NOTHING;
INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'ferie/002_piano_annuale.sql', 'Piano Ferie: piano annuale per area (piani per persona e anno, richieste agganciate)',
       coalesce(jsonb_object_agg(voce, dettaglio), '{}'::jsonb) FROM _f002;
