-- Programma "anagrafica unica e Suite interconnessa" (approvato dal CEO l'08/11/2026), blocco 3 (correzioni B e C). Migrazione
-- idempotente e NON distruttiva: nessuna riga cancellata, nessuna colonna eliminata; i soli dati modificati sono i tipi delle Legal
-- entity (decisione 8), ognuno con la nota sulla riga e il rapporto in audit_log (MIGRAZIONE_RAPPORTO).
CREATE TEMP TABLE IF NOT EXISTS _m045 (voce TEXT, n INT, dettaglio JSONB) ON COMMIT DROP;

-- B5 (decisione 8 del CEO): tipi delle Legal entity assegnati dal creatore e non dal ruolo.
--   - locatori (Legal entity indicate come locatore di una sede o di un contratto di Payments) creati come PARTNER → FORNITORE, se non
--     sono anche partner di un punto prelievi (ospitanti o controparti di un contratto PP);
--   - partner dei punti prelievo (ospitanti di una sede, controparti di un contratto PP, Legal entity di un account PP) creati come
--     CLIENTE → PARTNER, salvo che siano anche clienti (account Service o MdL, sede SERVICE): restano CLIENTE con la nota.
-- Le società del gruppo (GRUPPO, SOCIETA), i TARGET e i FORNITORE non si toccano mai. La funzione è richiamata anche dalla migrazione
-- 019 del Business Hub (quando il modulo parte dopo il core) e restituisce il rapporto in JSON.
CREATE OR REPLACE FUNCTION public.riclassifica_tipi_legal_entity() RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE
  partner_ids INT[] := ARRAY[]::INT[];
  clienti_ids INT[] := ARRAY[]::INT[];
  locatori_ids INT[] := ARRAY[]::INT[];
  tmp INT[];
  a_fornitore JSONB; a_partner JSONB; restano JSONB;
BEGIN
  -- partner dei punti prelievo
  SELECT coalesce(array_agg(DISTINCT host_organization_id), ARRAY[]::INT[]) INTO partner_ids FROM public.sites WHERE host_organization_id IS NOT NULL;
  IF to_regclass('business.contracts') IS NOT NULL THEN
    EXECUTE $q$SELECT coalesce(array_agg(DISTINCT org_id), ARRAY[]::INT[]) FROM business.contracts WHERE kind = 'PP' AND org_id IS NOT NULL AND status <> 'ANNULLATO'$q$ INTO clienti_ids;
    partner_ids := partner_ids || clienti_ids;
  END IF;
  IF to_regclass('business.accounts') IS NOT NULL THEN
    EXECUTE $q$SELECT coalesce(array_agg(DISTINCT organization_id), ARRAY[]::INT[]) FROM business.accounts WHERE linea = 'PP'$q$ INTO clienti_ids;
    partner_ids := partner_ids || clienti_ids;
    EXECUTE $q$SELECT coalesce(array_agg(DISTINCT organization_id), ARRAY[]::INT[]) FROM business.accounts WHERE linea IN ('SRV','MDL')$q$ INTO clienti_ids;
  ELSE
    clienti_ids := ARRAY[]::INT[];
  END IF;
  clienti_ids := clienti_ids || coalesce((SELECT array_agg(DISTINCT organization_id) FROM public.sites WHERE kind = 'SERVICE' AND organization_id IS NOT NULL), ARRAY[]::INT[]);
  -- locatori: indicati come locatore di una sede o di un contratto di Payments, o creati dalla lettura di un contratto di locazione
  SELECT coalesce(array_agg(DISTINCT lease_landlord_org_id), ARRAY[]::INT[]) INTO locatori_ids FROM public.sites WHERE lease_landlord_org_id IS NOT NULL;
  locatori_ids := locatori_ids || coalesce((SELECT array_agg(id) FROM public.organizations WHERE kind = 'PARTNER' AND (notes ILIKE '%contratto di locazione%' OR notes ILIKE '%Scadenziario strutture%')), ARRAY[]::INT[]);
  IF to_regclass('finance.lease_contracts') IS NOT NULL THEN
    EXECUTE $q$SELECT coalesce(array_agg(DISTINCT landlord_org_id), ARRAY[]::INT[]) FROM finance.lease_contracts WHERE landlord_org_id IS NOT NULL$q$ INTO tmp;
    locatori_ids := locatori_ids || tmp;
  END IF;

  -- locatori PARTNER (non partner di punti prelievo) → FORNITORE
  WITH x AS (
    UPDATE public.organizations o SET kind = 'FORNITORE', updated_at = now(),
           notes = concat_ws(E'\n', nullif(o.notes, ''), 'Tipo cambiato da PARTNER a FORNITORE l''08/11/2026: è un locatore (decisione 8 del CEO, migrazione 045).')
     WHERE o.kind = 'PARTNER' AND o.id = ANY(locatori_ids) AND NOT (o.id = ANY(partner_ids))
    RETURNING o.id, o.name)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY id), '[]'::jsonb) INTO a_fornitore FROM x;

  -- partner dei punti prelievo CLIENTE (non clienti del servizio) → PARTNER
  WITH x AS (
    UPDATE public.organizations o SET kind = 'PARTNER', updated_at = now(),
           notes = concat_ws(E'\n', nullif(o.notes, ''), 'Tipo cambiato da CLIENTE a PARTNER l''08/11/2026: è partner di un punto prelievi (decisione 8 del CEO, migrazione 045).')
     WHERE o.kind = 'CLIENTE' AND o.id = ANY(partner_ids) AND NOT (o.id = ANY(clienti_ids))
    RETURNING o.id, o.name)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY id), '[]'::jsonb) INTO a_partner FROM x;

  -- partner che sono anche clienti: restano CLIENTE, con la nota (una volta sola)
  WITH x AS (
    UPDATE public.organizations o SET updated_at = now(),
           notes = concat_ws(E'\n', nullif(o.notes, ''), 'Resta CLIENTE anche se è partner di un punto prelievi: è anche cliente del Service o della Medicina del Lavoro (decisione 8 del CEO, migrazione 045).')
     WHERE o.kind = 'CLIENTE' AND o.id = ANY(partner_ids) AND o.id = ANY(clienti_ids) AND coalesce(o.notes, '') NOT LIKE '%Resta CLIENTE anche se è partner di un punto prelievi%'
    RETURNING o.id, o.name)
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) ORDER BY id), '[]'::jsonb) INTO restano FROM x;

  RETURN jsonb_build_object('locatori_a_fornitore', a_fornitore, 'partner_a_partner', a_partner, 'partner_restano_clienti', restano);
END $$;

DO $$
DECLARE r JSONB;
BEGIN
  r := public.riclassifica_tipi_legal_entity();
  INSERT INTO _m045 VALUES ('locatori_partner_a_fornitore', jsonb_array_length(r->'locatori_a_fornitore'), r->'locatori_a_fornitore');
  INSERT INTO _m045 VALUES ('partner_pp_cliente_a_partner', jsonb_array_length(r->'partner_a_partner'), r->'partner_a_partner');
  INSERT INTO _m045 VALUES ('partner_pp_restano_clienti', jsonb_array_length(r->'partner_restano_clienti'), r->'partner_restano_clienti');
END $$;
INSERT INTO _m045 SELECT 'richiedenti_spedizioni_cliente_invariati', count(*)::int, NULL FROM organizations WHERE kind = 'CLIENTE' AND notes ILIKE 'Creata da Shipments%';

-- B19: unicità del codice StudioLAB (indice parziale, maiuscole e minuscole uguali). Si crea solo se non ci sono doppioni (D15b = 0);
-- altrimenti resta l'elenco nel rapporto e la Diagnostica (D15b, "Attiva il vincolo") lo crea dopo la pulizia in Amministrazione > Sedi.
-- Nel frattempo saveSite rifiuta un codice già usato da un'altra sede.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sites WHERE coalesce(studiolab_code, '') <> '' GROUP BY lower(studiolab_code) HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS sites_studiolab_code_uq ON sites (lower(studiolab_code)) WHERE coalesce(studiolab_code, '') <> '';
    INSERT INTO _m045 VALUES ('indice_studiolab_unico', 1, NULL);
  ELSE
    INSERT INTO _m045 SELECT 'codici_studiolab_doppi', count(*)::int, jsonb_agg(jsonb_build_object('codice', codice, 'sedi', sedi))
      FROM (SELECT lower(studiolab_code) AS codice, array_agg(id ORDER BY id) AS sedi FROM sites WHERE coalesce(studiolab_code, '') <> '' GROUP BY 1 HAVING count(*) > 1) d;
  END IF;
END $$;

-- B2: responsabile di sede dall'organigramma (responsabile ATTIVO del nodo Sede, come GET /api/sites e le viste di Audit, Room, Facility,
-- Ordini) per le viste dei moduli che leggevano il testo sites.manager_name (Retail, NC: migrazioni retail 011 e nc 008).
-- sites.manager_name resta (non distruttiva) ma nessuno la scrive più: il connettore la ignora.
CREATE OR REPLACE FUNCTION public.responsabile_sede(p_site INT) RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT pp.last_name || ' ' || pp.first_name FROM public.org_units u JOIN public.org_positions op ON op.unit_id = u.id AND op.is_head
    JOIN public.people pp ON pp.id = op.person_id AND pp.status = 'ATTIVO'
   WHERE u.kind = 'SEDE' AND u.site_id = p_site ORDER BY op.sort_order, op.id LIMIT 1
$$;
-- Sostituzione di un'espressione nella definizione corrente di una vista (idempotente: se il nuovo testo c'è già non fa nulla)
CREATE OR REPLACE FUNCTION public.vista_sostituisci(vista TEXT, da TEXT, a TEXT) RETURNS BOOLEAN LANGUAGE plpgsql AS $$
DECLARE d TEXT; n TEXT;
BEGIN
  IF to_regclass(vista) IS NULL THEN RETURN FALSE; END IF;
  d := pg_get_viewdef(vista::regclass, true);
  IF position(a IN d) > 0 THEN RETURN FALSE; END IF;
  n := replace(d, da, a);
  IF n = d THEN RETURN FALSE; END IF;
  EXECUTE format('CREATE OR REPLACE VIEW %s AS %s', vista, rtrim(n, '; '));
  RETURN TRUE;
END $$;
INSERT INTO _m045 SELECT 'sedi_con_manager_name_testo_non_piu_letto', count(*)::int, NULL FROM sites WHERE coalesce(manager_name, '') <> '';

-- B3/B4: un solo proprietario per orari, superficie, locali, box e ambulatori.
--   orari di apertura: core (sites.opening_hours_json): ore e giorni di apertura settimanali calcolati da qui (Facility li usa per
--   gli indicatori energetici al posto del valore scritto a mano); superficie, locali e box: Facility (facility.properties);
--   ambulatori: Room (room.site_ext.data.ambulatori). Le funzioni sotto leggono gli schemi dei moduli solo se esistono.
CREATE OR REPLACE FUNCTION public.ore_apertura_settimana(j JSONB) RETURNS NUMERIC LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN j IS NULL OR jsonb_typeof(j) <> 'object' THEN NULL ELSE
    round(coalesce((SELECT sum(extract(epoch FROM ((f->>'to')::time - (f->>'from')::time)) / 3600.0)
       FROM jsonb_each(j) d, jsonb_array_elements(CASE WHEN jsonb_typeof(d.value) = 'array' THEN d.value ELSE '[]'::jsonb END) f
      WHERE (f->>'from') ~ '^\d{2}:\d{2}$' AND (f->>'to') ~ '^\d{2}:\d{2}$' AND (f->>'to') > (f->>'from')), 0)::numeric, 1) END
$$;
CREATE OR REPLACE FUNCTION public.giorni_apertura_settimana(j JSONB) RETURNS INT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN j IS NULL OR jsonb_typeof(j) <> 'object' THEN NULL ELSE
    (SELECT count(*)::int FROM jsonb_each(j) d WHERE jsonb_typeof(d.value) = 'array' AND jsonb_array_length(d.value) > 0) END
$$;
CREATE OR REPLACE FUNCTION public.facility_sede(p_site INT, OUT surface_sqm NUMERIC, OUT rooms INT, OUT boxes INT) LANGUAGE plpgsql STABLE AS $$
BEGIN
  IF to_regclass('facility.properties') IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'facility' AND table_name = 'properties' AND column_name = 'boxes') THEN
    EXECUTE 'SELECT surface_sqm, rooms, boxes FROM facility.properties WHERE site_id = $1' INTO surface_sqm, rooms, boxes USING p_site;
  ELSE
    EXECUTE 'SELECT surface_sqm, rooms FROM facility.properties WHERE site_id = $1' INTO surface_sqm, rooms USING p_site;
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.ambulatori_room(p_site INT) RETURNS INT LANGUAGE plpgsql STABLE AS $$
DECLARE n INT;
BEGIN
  IF to_regclass('room.site_ext') IS NULL THEN RETURN NULL; END IF;
  EXECUTE $q$SELECT CASE WHEN jsonb_typeof(data->'ambulatori') = 'array' THEN jsonb_array_length(data->'ambulatori') END FROM room.site_ext WHERE site_id = $1$q$ INTO n USING p_site;
  RETURN n;
END $$;
-- Superficie e box scritti finora in Retail (retail.site_ext) passano a Facility dove Facility non li ha (mai sovrascritti); chiamata
-- dalle migrazioni di Retail (013) e Facility (005), funziona solo quando entrambi i moduli sono avviati. Ritorna il conteggio.
CREATE OR REPLACE FUNCTION public.consolida_superfici_in_facility() RETURNS INT LANGUAGE plpgsql AS $$
DECLARE n INT := 0;
BEGIN
  IF to_regclass('retail.site_ext') IS NULL OR to_regclass('facility.properties') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'facility' AND table_name = 'properties' AND column_name = 'boxes') THEN RETURN 0; END IF;
  EXECUTE $q$
    WITH x AS (
      INSERT INTO facility.properties (site_id, surface_sqm, boxes, notes)
      SELECT e.site_id, e.surface_sqm, e.boxes, 'Superficie e box ripresi da Retail Assistant (migrazione dell''anagrafica unica, 08/11/2026)'
        FROM retail.site_ext e JOIN public.sites s ON s.id = e.site_id
       WHERE s.kind <> 'SERVICE' AND (e.surface_sqm IS NOT NULL OR e.boxes IS NOT NULL)
      ON CONFLICT (site_id) DO UPDATE SET surface_sqm = coalesce(facility.properties.surface_sqm, EXCLUDED.surface_sqm), boxes = coalesce(facility.properties.boxes, EXCLUDED.boxes)
       WHERE (facility.properties.surface_sqm IS NULL AND EXCLUDED.surface_sqm IS NOT NULL) OR (facility.properties.boxes IS NULL AND EXCLUDED.boxes IS NOT NULL)
      RETURNING 1)
    SELECT count(*)::int FROM x$q$ INTO n;
  RETURN n;
END $$;
INSERT INTO _m045 VALUES ('superfici_box_portati_in_facility', public.consolida_superfici_in_facility(), NULL);

-- B5b: le fusioni di Legal entity si registrano qui (chi resta, chi è assorbita, riferimenti spostati per tabella, campi presi)
CREATE TABLE IF NOT EXISTS org_merges (
  id           BIGSERIAL PRIMARY KEY,
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  by_user      INT REFERENCES users(id) ON DELETE SET NULL,
  kept_id      INT NOT NULL,
  merged_id    INT NOT NULL,
  merged_row   JSONB NOT NULL,
  report       JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS org_merges_kept_idx ON org_merges (kept_id);

-- Rapporto
INSERT INTO audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', '045_anagrafica_blocco3.sql', 'Anagrafica unica, blocco 3: tipi delle Legal entity (decisione 8), unicità del codice StudioLAB, registro delle fusioni',
       coalesce(jsonb_object_agg(voce, jsonb_build_object('n', n, 'dettaglio', dettaglio)), '{}'::jsonb) FROM _m045;
