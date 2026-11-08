-- Programma "anagrafica unica e Suite interconnessa" (approvato dal CEO l'08/11/2026), blocco 1. Migrazione idempotente e NON
-- distruttiva: nessuna riga cancellata, nessuna colonna eliminata; il rapporto va in audit_log (MIGRAZIONE_RAPPORTO).
CREATE TEMP TABLE IF NOT EXISTS _m043 (voce TEXT, n INT) ON COMMIT DROP;

-- A0 / B17 minimo: data di chiusura della sede (impostata da saveSite alla disattivazione; A1 la usa al contratto PP cessato)
ALTER TABLE sites ADD COLUMN IF NOT EXISTS closed_at DATE;

-- A8: responsabili di sede solo tra le persone attive. Funzione usata dalle migrazioni dei moduli (audit, room, facility, orders) per
-- ridefinire le loro viste sites_v partendo dalla definizione corrente: alla join con people del responsabile si aggiunge
-- "pp.status = 'ATTIVO'". Idempotente: non fa nulla se la vista non esiste o ha già il filtro.
CREATE OR REPLACE FUNCTION public.responsabili_solo_attivi(vista TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE d TEXT; n TEXT;
BEGIN
  IF to_regclass(vista) IS NULL THEN RETURN FALSE; END IF;
  d := pg_get_viewdef(vista::regclass, true);
  IF d ~ 'pp\.status' THEN RETURN FALSE; END IF;
  n := regexp_replace(d, '(JOIN (public\.)?people pp ON \(*pp\.id = op\.person_id\)*)', '\1 AND pp.status = ''ATTIVO''', 'g');
  IF n = d THEN RETURN FALSE; END IF;
  EXECUTE format('CREATE OR REPLACE VIEW %s AS %s', vista, rtrim(n, '; '));
  RETURN TRUE;
END $$;

-- A8: un solo nodo SEDE per sede. L'indice unico parziale si crea solo se non ci sono doppioni (verifica D18a): altrimenti si crea
-- dopo la correzione "Unisci i nodi doppi" della Diagnostica anagrafica (routes/diagnostica.js chiama assicuraIndiceNodiSede).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM org_units WHERE kind = 'SEDE' AND site_id IS NOT NULL GROUP BY site_id HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS org_units_sede_site_uq ON org_units (site_id) WHERE kind = 'SEDE' AND site_id IS NOT NULL;
    INSERT INTO _m043 VALUES ('indice_nodo_sede_creato', 1);
  ELSE
    INSERT INTO _m043 SELECT 'sedi_con_nodi_doppi_d18a', count(*)::int FROM (SELECT site_id FROM org_units WHERE kind = 'SEDE' AND site_id IS NOT NULL GROUP BY site_id HAVING count(*) > 1) x;
  END IF;
END $$;

-- A13: esiti della Diagnostica anagrafica (job giornaliero core:diagnostica e "Esegui adesso")
CREATE TABLE IF NOT EXISTS diagnostica_runs (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_user    INT REFERENCES users(id) ON DELETE SET NULL,
  risultati  JSONB NOT NULL,            -- [{ id, gravita, stato, n }]
  bloccanti  INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS diagnostica_runs_at_idx ON diagnostica_runs (at DESC);

-- A3: documenti della sede con etichetta e origine (contratti SEDE del Business Hub portati in Sedi, sezione "Altri documenti")
ALTER TABLE site_documents ADD COLUMN IF NOT EXISTS label TEXT;
ALTER TABLE site_documents ADD COLUMN IF NOT EXISTS origin TEXT;

-- Rapporto
INSERT INTO _m043 SELECT 'sedi_disattivate_senza_data_chiusura', count(*)::int FROM sites WHERE NOT active AND closed_at IS NULL;
INSERT INTO audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', '043_anagrafica_governo.sql', 'Anagrafica unica, blocco 1: chiusura sedi, nodo Sede unico, Diagnostica, documenti di sede',
       coalesce(jsonb_object_agg(voce, n), '{}'::jsonb) FROM _m043;
