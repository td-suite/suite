-- Piano Ferie: l'approvatore è il superiore diretto dell'anagrafica (decisione del CEO, 09/11/2026: "dobbiamo recepire non solo le aree
-- ma anche il secondo livello. Esempio: Masseria la approva Malenchini, non io. Le mie ferie non devono essere approvate perché non ho
-- nessuno sopra in organigramma. Segui pedissequamente quanto indicato in organigramma").
-- Superiore diretto = public.people_manager(id) ("Dipende da" di Amministrazione > Persone: manager_person_id a mano, altrimenti il
-- responsabile dall'organigramma; NULL per il vertice). Se è cessato o senza accesso attivo alla Suite si risale al superiore del
-- superiore. Il modulo non copia l'organigramma: questa migrazione non crea tabelle, legge l'anagrafica e sistema i piani aperti.
--
-- Idempotente e non distruttiva (la Suite è in produzione): nessuna riga cancellata, nessuna colonna tolta.
-- 1. nuovo tipo di evento del piano RIASSEGNATO (vincolo allargato, valori esistenti invariati);
-- 2. piani PROPOSTO e IN_REVISIONE (inviati, in attesa di approvazione) e variazioni in attesa: restano come sono ma sono riassegnati
--    all'approvatore effettivo (richieste.approvatore_person_id dei periodi aperti, evento RIASSEGNATO con superiore, approvatore e
--    superiori saltati); un solo evento per piano anche se la migrazione venisse rieseguita;
-- 3. il vertice (persona senza superiore con accesso OWNER attivo, il CEO) con il piano PROPOSTO o IN_REVISIONE: il piano diventa
--    DEFINITIVO con l'annotazione "senza approvatore in organigramma", i periodi del piano diventano approvati (goduti se già passati);
-- 4. chi non ha superiore e non è il vertice (anomalia dell'anagrafica, Diagnostica D43): il piano resta inviato, senza approvatore
--    (lo decide l'amministratore), ed è elencato nel rapporto;
-- 5. rapporto in public.audit_log (MIGRAZIONE_RAPPORTO, ferie/003_approvatore_superiore.sql).
-- Nessun dato inventato: approvatori e superiori vengono dall'anagrafica; le date sono quelle dell'esecuzione.

-- 1. Evento RIASSEGNATO --------------------------------------------------------------------------------------------------------
ALTER TABLE piano_eventi DROP CONSTRAINT IF EXISTS piano_eventi_tipo_check;
ALTER TABLE piano_eventi ADD CONSTRAINT piano_eventi_tipo_check CHECK (tipo IN ('CREATO','MIGRATO','PERIODO_AGGIUNTO','PERIODO_MODIFICATO','PERIODO_TOLTO',
  'INVIATO','IN_REVISIONE','APPROVATO','DEFINITIVO','RIAPERTO','VARIAZIONE_PROPOSTA','VARIAZIONE_APPROVATA','VARIAZIONE_RIFIUTATA','VARIAZIONE','PROMEMORIA','RIASSEGNATO'));

-- 2.-4. Piani aperti e variazioni in attesa ------------------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS _f003 (voce TEXT PRIMARY KEY, dettaglio JSONB) ON COMMIT DROP;
DO $$
DECLARE
  oggi_r   DATE := (now() AT TIME ZONE 'Europe/Rome')::date;
  owners   INT[] := ARRAY(SELECT DISTINCT person_id FROM public.users WHERE level = 'OWNER' AND status = 'ACTIVE' AND person_id IS NOT NULL);
  r        RECORD;
  pr       RECORD;
  sup      INT;
  cur      INT;
  giri     INT;
  saltati  JSONB;
  n_riass  INT := 0; n_var INT := 0; n_def INT := 0; n_per INT := 0;
  riass    JSONB := '[]'::jsonb; definitivi JSONB := '[]'::jsonb; senza JSONB := '[]'::jsonb; irragg JSONB := '[]'::jsonb;
BEGIN
  -- persone con un piano inviato o una variazione in attesa
  FOR r IN
    SELECT p.id AS person_id, p.last_name || ' ' || p.first_name AS nome FROM public.people p
     WHERE p.id IN (SELECT person_id FROM piani WHERE stato IN ('PROPOSTO','IN_REVISIONE')
                    UNION SELECT person_id FROM richieste WHERE stato = 'RICHIESTA' OR (variazione_proposta IS NOT NULL AND stato IN ('PIANIFICATA','APPROVATA')))
     ORDER BY p.id
  LOOP
    sup := public.people_manager(r.person_id);
    IF sup = r.person_id THEN sup := NULL; END IF;
    IF sup IS NULL THEN
      IF r.person_id = ANY(owners) THEN
        -- 3. il vertice: piani inviati → DEFINITIVO senza approvazione
        FOR pr IN SELECT id, anno, stato FROM piani WHERE person_id = r.person_id AND stato IN ('PROPOSTO','IN_REVISIONE') ORDER BY anno LOOP
          UPDATE piani SET stato = 'DEFINITIVO', approvato_at = now(), approvato_da = NULL, definitivo_at = now(), definitivo_da = NULL,
                 nota_approvatore = 'senza approvatore in organigramma', versione = versione + 1, updated_at = now()
           WHERE id = pr.id AND stato IN ('PROPOSTO','IN_REVISIONE');
          WITH per AS (
            UPDATE richieste SET stato = CASE WHEN data_fine < oggi_r THEN 'GODUTA' ELSE 'APPROVATA' END, deciso_at = now(), deciso_da_user_id = NULL,
                   approvatore_person_id = NULL, goduta_at = CASE WHEN data_fine < oggi_r THEN now() END, updated_at = now()
             WHERE piano_id = pr.id AND stato = 'PIANIFICATA' RETURNING id)
          INSERT INTO eventi (richiesta_id, tipo, user_id, dati)
          SELECT id, 'APPROVATA', NULL, '{"con_il_piano":true,"senza_approvatore":true,"nota":"senza approvatore in organigramma","migrazione":"003"}'::jsonb FROM per;
          GET DIAGNOSTICS giri = ROW_COUNT;
          n_per := n_per + giri;
          INSERT INTO piano_eventi (piano_id, tipo, user_id, dati)
          VALUES (pr.id, 'DEFINITIVO', NULL, jsonb_build_object('senza_approvatore', true, 'nota', 'senza approvatore in organigramma', 'da', pr.stato, 'periodi', giri, 'migrazione', '003'));
          n_def := n_def + 1;
          definitivi := definitivi || jsonb_build_object('persona', r.nome, 'anno', pr.anno, 'era', pr.stato, 'periodi_approvati', giri);
        END LOOP;
        -- le sue variazioni in attesa restano: le decide lui stesso come amministratore (nel rapporto)
        IF EXISTS (SELECT 1 FROM richieste WHERE person_id = r.person_id AND (stato = 'RICHIESTA' OR variazione_proposta IS NOT NULL)) THEN
          senza := senza || jsonb_build_object('persona', r.nome, 'vertice', true, 'nota', 'variazioni in attesa del vertice: le decide l''amministratore');
        END IF;
      ELSE
        -- 4. senza superiore e non vertice: anomalia, nessun approvatore
        UPDATE richieste SET approvatore_person_id = NULL, updated_at = now()
         WHERE person_id = r.person_id AND approvatore_person_id IS NOT NULL
           AND (stato IN ('PIANIFICATA','RICHIESTA') OR (variazione_proposta IS NOT NULL AND stato = 'APPROVATA'));
        senza := senza || jsonb_build_object('persona', r.nome, 'person_id', r.person_id,
          'piani', (SELECT coalesce(jsonb_agg(anno || ' ' || stato), '[]'::jsonb) FROM piani WHERE person_id = r.person_id AND stato IN ('PROPOSTO','IN_REVISIONE')));
        FOR pr IN SELECT id FROM piani WHERE person_id = r.person_id AND stato IN ('PROPOSTO','IN_REVISIONE') LOOP
          IF NOT EXISTS (SELECT 1 FROM piano_eventi WHERE piano_id = pr.id AND tipo = 'RIASSEGNATO' AND dati->>'migrazione' = '003') THEN
            INSERT INTO piano_eventi (piano_id, tipo, user_id, dati) VALUES (pr.id, 'RIASSEGNATO', NULL,
              jsonb_build_object('approvatore', NULL, 'senza_superiore', true, 'nota', 'nessun superiore in anagrafica: decide l''amministratore', 'migrazione', '003'));
          END IF;
        END LOOP;
      END IF;
      CONTINUE;
    END IF;
    -- 2. approvatore effettivo: il superiore, risalendo se cessato o senza accesso attivo
    cur := sup; giri := 0; saltati := '[]'::jsonb;
    LOOP
      EXIT WHEN cur IS NULL OR cur = r.person_id OR giri > 30;
      EXIT WHEN EXISTS (SELECT 1 FROM public.people x WHERE x.id = cur AND x.status = 'ATTIVO')
            AND EXISTS (SELECT 1 FROM public.users u WHERE u.person_id = cur AND u.status = 'ACTIVE');
      saltati := saltati || jsonb_build_object('id', cur, 'nome', (SELECT last_name || ' ' || first_name FROM public.people WHERE id = cur),
        'motivo', CASE WHEN EXISTS (SELECT 1 FROM public.people x WHERE x.id = cur AND x.status = 'ATTIVO') THEN 'non ha accesso alla Suite' ELSE 'è cessato' END);
      cur := public.people_manager(cur);
      giri := giri + 1;
    END LOOP;
    IF cur = r.person_id OR giri > 30 THEN cur := NULL; END IF;
    IF cur IS NULL THEN
      irragg := irragg || jsonb_build_object('persona', r.nome, 'person_id', r.person_id, 'saltati', saltati);
    END IF;
    UPDATE richieste SET approvatore_person_id = cur, updated_at = now()
     WHERE person_id = r.person_id AND approvatore_person_id IS DISTINCT FROM cur
       AND (stato IN ('PIANIFICATA','RICHIESTA') OR (variazione_proposta IS NOT NULL AND stato = 'APPROVATA'));
    GET DIAGNOSTICS giri = ROW_COUNT;
    n_var := n_var + giri;
    FOR pr IN SELECT id, anno, stato FROM piani WHERE person_id = r.person_id AND stato IN ('PROPOSTO','IN_REVISIONE') ORDER BY anno LOOP
      IF NOT EXISTS (SELECT 1 FROM piano_eventi WHERE piano_id = pr.id AND tipo = 'RIASSEGNATO' AND dati->>'migrazione' = '003') THEN
        INSERT INTO piano_eventi (piano_id, tipo, user_id, dati) VALUES (pr.id, 'RIASSEGNATO', NULL, jsonb_build_object(
          'superiore_id', sup, 'superiore', (SELECT last_name || ' ' || first_name FROM public.people WHERE id = sup),
          'approvatore_id', cur, 'approvatore', (SELECT last_name || ' ' || first_name FROM public.people WHERE id = cur),
          'saltati', saltati, 'nota', 'approva il superiore diretto in anagrafica (decisione del CEO del 09/11/2026)', 'migrazione', '003'));
        -- il promemoria al nuovo approvatore riparte dal prossimo giro del job
        UPDATE piani SET promemoria_at = NULL WHERE id = pr.id;
        n_riass := n_riass + 1;
        riass := riass || jsonb_build_object('persona', r.nome, 'anno', pr.anno, 'stato', pr.stato,
          'approvatore', coalesce((SELECT last_name || ' ' || first_name FROM public.people WHERE id = cur), 'amministratore (nessun superiore attivo con accesso)'));
      END IF;
    END LOOP;
  END LOOP;
  INSERT INTO _f003 VALUES ('piani_riassegnati_al_superiore', to_jsonb(n_riass)), ('dettaglio_riassegnati', riass),
    ('periodi_e_variazioni_riassegnati', to_jsonb(n_var)), ('piani_del_vertice_resi_definitivi', to_jsonb(n_def)), ('dettaglio_definitivi', definitivi),
    ('periodi_approvati_con_il_definitivo', to_jsonb(n_per)), ('senza_superiore_da_sistemare_in_anagrafica', senza), ('senza_superiore_attivo_con_accesso', irragg)
  ON CONFLICT (voce) DO NOTHING;
  -- approvatori ferie del dossier HR (contracts.person_ext.approver_id) diversi dal superiore: da ora ignorati dal Piano Ferie
  IF to_regclass('contracts.person_ext') IS NOT NULL THEN
    EXECUTE $q$INSERT INTO _f003 SELECT 'approvatore_dossier_hr_non_piu_usato', coalesce(jsonb_agg(jsonb_build_object('persona', p.last_name || ' ' || p.first_name,
        'approvatore_dossier', a.last_name || ' ' || a.first_name, 'superiore', (SELECT s.last_name || ' ' || s.first_name FROM public.people s WHERE s.id = public.people_manager(p.id)))), '[]'::jsonb)
      FROM contracts.person_ext x JOIN public.people p ON p.id = x.person_id JOIN public.people a ON a.id = x.approver_id
     WHERE p.status = 'ATTIVO' AND x.approver_id IS DISTINCT FROM public.people_manager(p.id)
    ON CONFLICT (voce) DO NOTHING$q$;
  END IF;
END $$;

-- 5. Rapporto ------------------------------------------------------------------------------------------------------------------
INSERT INTO _f003 SELECT 'piani_per_stato_dopo', coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
  FROM (SELECT anno || ' ' || stato AS k, count(*)::int AS n FROM piani GROUP BY anno, stato) t ON CONFLICT (voce) DO NOTHING;
INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'ferie/003_approvatore_superiore.sql', 'Piano Ferie: approva il superiore diretto in anagrafica (piani inviati riassegnati, vertice senza approvazione)',
       coalesce(jsonb_object_agg(voce, dettaglio), '{}'::jsonb) FROM _f003;
