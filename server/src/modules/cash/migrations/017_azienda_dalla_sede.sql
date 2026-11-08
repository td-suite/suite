-- Programma "anagrafica unica", blocco 3 (08/11/2026), B6: l'azienda di Cash di una sede è la sua Legal entity proprietaria
-- (public.sites.organization_id), allineata dal core (lib/sites.js syncCompanyToCash). Migrazione NON distruttiva: nessun dato toccato;
-- le sedi da allineare compaiono nel rapporto e nel controllo D07 della Diagnostica anagrafica, che le corregge con conferma.
INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'cash/017_azienda_dalla_sede.sql', 'Cash: azienda della sede = Legal entity proprietaria (B6)',
       jsonb_build_object('sedi_con_azienda_diversa_d07', coalesce(jsonb_agg(jsonb_build_object('site_id', s.id, 'code', s.code, 'company_id', e.company_id, 'organization_id', s.organization_id)), '[]'::jsonb),
                          'n', count(*))
  FROM site_ext e JOIN public.sites s ON s.id = e.site_id WHERE e.company_id IS DISTINCT FROM s.organization_id;

-- C8 (prima passata, controllo D40): tabelle residue dello scadenziario messo per errore in Cash nella v0.28 (poi spostato in Payments).
-- Nessuna migrazione attuale le crea; dove esistono si eliminano solo se VUOTE (nessun dato perso), altrimenti restano e il rapporto le
-- elenca con il numero di righe (decisione in Amministrazione: i dati veri stanno in Payments).
CREATE TEMP TABLE IF NOT EXISTS _c017 (tabella TEXT, righe BIGINT, azione TEXT) ON COMMIT DROP;
DO $$
DECLARE t TEXT; n BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY['schedule_done', 'utilities', 'lease_contracts'] LOOP
    IF to_regclass('cash.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM cash.%I', t) INTO n;
      IF n = 0 THEN
        BEGIN
          EXECUTE format('DROP TABLE cash.%I', t);
          INSERT INTO _c017 VALUES ('cash.' || t, 0, 'eliminata (vuota)');
        EXCEPTION WHEN dependent_objects_still_exist THEN
          INSERT INTO _c017 VALUES ('cash.' || t, 0, 'non eliminata: altri oggetti dipendono dalla tabella');
        END;
      ELSE
        INSERT INTO _c017 VALUES ('cash.' || t, n, 'conservata: contiene dati');
      END IF;
    END IF;
  END LOOP;
END $$;
INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'cash/017_azienda_dalla_sede.sql#C8', 'Cash: tabelle residue dello scadenziario (C8, D40)',
       coalesce(jsonb_agg(jsonb_build_object('tabella', tabella, 'righe', righe, 'azione', azione)), '[]'::jsonb) FROM _c017;
