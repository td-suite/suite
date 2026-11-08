-- Programma "anagrafica unica e Suite interconnessa" (approvato dal CEO l'08/11/2026), blocco 2. Migrazione idempotente e NON
-- distruttiva: nessuna riga cancellata, nessuna colonna eliminata, nessun dato modificato; il rapporto va in audit_log
-- (MIGRAZIONE_RAPPORTO).
CREATE TEMP TABLE IF NOT EXISTS _m044 (voce TEXT, n INT) ON COMMIT DROP;

-- A5 (decisione 1 del CEO): vista unica dei clienti del Service e della Medicina del Lavoro, usata da tutta la Suite (Ordini, NC,
-- Portale Service, Circolari, Diagnostica; lib/clienti.js per il codice). Due livelli:
--   ATTIVO            = accounts.cliente_attivo (fase 7 confermata dal CEO), dal = attivo_dal, fonte 'CEO';
--   CONTRATTUALIZZATO = contrattualizzato_at valorizzato oppure contratto della linea FIRMATO/ATTIVO, purché la linea non sia
--                       cessata (contratti della linea tutti CESSATI/ANNULLATI e almeno uno CESSATO); dal = data della
--                       contrattualizzazione o della firma, fonte 'CONTRATTUALIZZAZIONE' o 'CONTRATTO'.
-- Sempre con la Legal entity attiva. Una riga per Legal entity e linea (SRV, MDL).
-- La vista legge lo schema del Business Hub: se il modulo non è ancora avviato la vista esiste vuota con le stesse colonne, e la
-- migrazione 018 del Business Hub la ricrea completa (stessa funzione). Le viste dei moduli non dipendono direttamente da questa:
-- passano dalla funzione public.cliente_livello, così la vista si può ricreare senza toccare quelle dei moduli.
CREATE OR REPLACE FUNCTION public.clienti_attivi_ricrea() RETURNS TEXT LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass('business.accounts') IS NOT NULL AND to_regclass('business.contracts') IS NOT NULL THEN
    EXECUTE $v$
      CREATE OR REPLACE VIEW public.clienti_attivi_v AS
      SELECT a.organization_id AS org_id, a.linea,
             CASE WHEN a.cliente_attivo THEN 'ATTIVO' ELSE 'CONTRATTUALIZZATO' END AS livello,
             CASE WHEN a.cliente_attivo THEN coalesce(a.attivo_dal, CASE WHEN a.phase_dates->>'7' ~ '^\d{4}-\d{2}-\d{2}$' THEN (a.phase_dates->>'7')::date END)
                  ELSE coalesce((a.contrattualizzato_at AT TIME ZONE 'Europe/Rome')::date, c.firmato_il) END AS dal,
             CASE WHEN a.cliente_attivo THEN 'CEO' WHEN a.contrattualizzato_at IS NOT NULL THEN 'CONTRATTUALIZZAZIONE' ELSE 'CONTRATTO' END AS fonte,
             a.id AS account_id
        FROM business.accounts a
        JOIN public.organizations o ON o.id = a.organization_id AND o.active
        LEFT JOIN LATERAL (
          SELECT count(*) FILTER (WHERE k.status IN ('FIRMATO','ATTIVO')) AS vigenti,
                 count(*) FILTER (WHERE k.status = 'CESSATO') AS cessati,
                 count(*) FILTER (WHERE k.status NOT IN ('CESSATO','ANNULLATO')) AS non_chiusi,
                 min(coalesce(k.signed_at, k.start_date)) FILTER (WHERE k.status IN ('FIRMATO','ATTIVO')) AS firmato_il
            FROM business.contracts k WHERE k.org_id = a.organization_id AND k.kind = a.linea) c ON TRUE
       WHERE a.linea IN ('SRV','MDL')
         AND (a.cliente_attivo
              OR ((a.contrattualizzato_at IS NOT NULL OR c.vigenti > 0) AND NOT (c.cessati > 0 AND c.non_chiusi = 0)))
    $v$;
    RETURN 'completa';
  END IF;
  IF to_regclass('public.clienti_attivi_v') IS NULL THEN
    EXECUTE $v$
      CREATE VIEW public.clienti_attivi_v AS
      SELECT NULL::int AS org_id, NULL::text AS linea, NULL::text AS livello, NULL::date AS dal, NULL::text AS fonte, NULL::int AS account_id WHERE FALSE
    $v$;
    RETURN 'vuota (Business Hub non avviato)';
  END IF;
  RETURN 'invariata';
END $$;
INSERT INTO _m044 SELECT 'clienti_attivi_v: ' || public.clienti_attivi_ricrea(), 1;

-- Livello di "cliente servizio" di una Legal entity per le viste dei moduli (Ordini, NC) e per il codice: ATTIVO, CONTRATTUALIZZATO
-- (da clienti_attivi_v, entrambe le linee) oppure PUNTO_SERVICE (ha almeno una sede SERVICE attiva: il servizio c'è anche se il
-- Business Hub non lo sa); NULL = non è un cliente del servizio.
CREATE OR REPLACE FUNCTION public.cliente_livello(p_org INT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.clienti_attivi_v v WHERE v.org_id = p_org AND v.livello = 'ATTIVO') THEN 'ATTIVO'
    WHEN EXISTS (SELECT 1 FROM public.clienti_attivi_v v WHERE v.org_id = p_org) THEN 'CONTRATTUALIZZATO'
    WHEN EXISTS (SELECT 1 FROM public.sites s WHERE s.organization_id = p_org AND s.kind = 'SERVICE' AND s.active) THEN 'PUNTO_SERVICE'
  END
$$;

-- A7 (d): indirizzo della sede SERVICE ereditato dalla Legal entity. TRUE = l'indirizzo è quello della Legal entity e la segue quando
-- cambia (lib/clienti.js allineaSediDaOrg); diventa FALSE quando qualcuno scrive a mano un indirizzo diverso nella sede.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS address_from_org BOOLEAN NOT NULL DEFAULT FALSE;

-- Rapporto (solo conteggi)
INSERT INTO _m044 SELECT 'clienti_attivi_righe', count(*)::int FROM public.clienti_attivi_v;
INSERT INTO _m044 SELECT 'sedi_service_attive', count(*)::int FROM sites WHERE kind = 'SERVICE' AND active;
INSERT INTO _m044 SELECT 'sedi_service_senza_codice_studiolab', count(*)::int FROM sites WHERE kind = 'SERVICE' AND active AND coalesce(studiolab_code, '') = '';
INSERT INTO audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', '044_clienti_attivi.sql', 'Anagrafica unica, blocco 2: vista dei clienti attivi e contrattualizzati, indirizzo ereditato delle sedi SERVICE',
       coalesce(jsonb_object_agg(voce, n), '{}'::jsonb) FROM _m044;
