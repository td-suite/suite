-- Programma "anagrafica unica", blocco 2 (08/11/2026). Migrazione idempotente e NON distruttiva (nessuna riga cancellata, nessuna
-- colonna eliminata); il rapporto va in public.audit_log (MIGRAZIONE_RAPPORTO).
CREATE TEMP TABLE IF NOT EXISTS _b018 (voce TEXT, n INT) ON COMMIT DROP;

-- A5: la vista public.clienti_attivi_v (migrazione core 044) si ricrea completa ora che le tabelle del Business Hub ci sono
INSERT INTO _b018 SELECT 'clienti_attivi_v: ' || public.clienti_attivi_ricrea(), 1;

-- A7 (c), decisione 5: codice StudioLAB del cliente. La fonte è la sede SERVICE (public.sites.studiolab_code, letta da Ordini, NC e
-- Retail); questa colonna conserva il codice inserito nella scheda account quando il cliente non ha ancora la sede SERVICE e lo
-- consegna alla sede quando nasce (lib/clienti.js creaSedeService). Con la sede già presente la scheda scrive direttamente nella sede.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS studiolab_code TEXT;

-- A5: attivo_dal coerente con il flag del CEO. Solo completamenti di valori vuoti (nessun dato sovrascritto):
-- cliente attivo senza data → data della fase 7, se è una data valida.
WITH x AS (
  UPDATE accounts SET attivo_dal = (phase_dates->>'7')::date, updated_at = now()
   WHERE cliente_attivo AND attivo_dal IS NULL AND phase_dates->>'7' ~ '^\d{4}-\d{2}-\d{2}$' RETURNING id)
INSERT INTO _b018 SELECT 'attivo_dal_completata_dalla_fase_7', count(*)::int FROM x;
-- solo conteggi (da sistemare dalla scheda: il cliente attivo lo dice il CEO)
INSERT INTO _b018 SELECT 'clienti_attivi_senza_data', count(*)::int FROM accounts WHERE cliente_attivo AND attivo_dal IS NULL;
INSERT INTO _b018 SELECT 'non_attivi_con_attivo_dal', count(*)::int FROM accounts WHERE NOT cliente_attivo AND attivo_dal IS NOT NULL;
INSERT INTO _b018 SELECT 'account_con_contratto_vigente_ancora_prospect_d12', count(*)::int FROM accounts a
 WHERE EXISTS (SELECT 1 FROM contracts c WHERE c.org_id = a.organization_id AND c.kind = a.linea AND c.status IN ('FIRMATO','AUTORIZZATO','ATTIVO'))
   AND (a.prospect OR a.contrattualizzato_at IS NULL OR a.fase_corrente < 6);
INSERT INTO _b018 SELECT 'clienti_attivi_v_' || lower(linea) || '_' || lower(livello), count(*)::int FROM public.clienti_attivi_v GROUP BY linea, livello;

INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'business/018_clienti_attivi.sql', 'Business Hub, anagrafica unica blocco 2: clienti attivi e contrattualizzati, codice StudioLAB dell''account',
       coalesce(jsonb_object_agg(voce, n), '{}'::jsonb) FROM _b018;
