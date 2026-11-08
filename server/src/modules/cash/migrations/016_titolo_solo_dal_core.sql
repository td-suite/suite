-- A2 (programma anagrafica unica, 08/11/2026): titolo di godimento e Legal entity ospitante si leggono SOLO dall'anagrafica
-- (public.sites.tenure e host_organization_id, Amministrazione > Sedi). Cash non li scrive più (routes/admin.js) e la vista non usa
-- più la riserva site_ext.host_org_id. Migrazione idempotente e non distruttiva:
-- 1. completa l'ospitante del core SOLO dove il core è OSPITATA senza ospitante e Cash ne conosce uno (campo vuoto, nessuna sovrascrittura);
-- 2. sostituisce la vista con le stesse colonne (CREATE OR REPLACE), senza riserva;
-- 3. le colonne site_ext.ownership e site_ext.host_org_id restano (specchio scritto dal core, controllo D06): nessuna colonna eliminata;
-- 4. scrive il rapporto in public.audit_log (MIGRAZIONE_RAPPORTO) con i conteggi.
CREATE TEMP TABLE IF NOT EXISTS _a2_rapporto (voce TEXT, n INT) ON COMMIT DROP;
WITH x AS (
  UPDATE public.sites s SET host_organization_id = e.host_org_id, updated_at = now()
    FROM site_ext e
   WHERE e.site_id = s.id AND s.tenure = 'OSPITATA' AND s.host_organization_id IS NULL AND e.host_org_id IS NOT NULL
  RETURNING s.id)
INSERT INTO _a2_rapporto SELECT 'ospitante_completato_dal_cash', count(*)::int FROM x;
-- disallineamenti residui (D06): non si correggono qui, si vedono in Amministrazione > Diagnostica anagrafica
INSERT INTO _a2_rapporto SELECT 'disallineati_d06', count(*)::int FROM public.sites s JOIN site_ext e ON e.site_id = s.id
 WHERE e.host_org_id IS DISTINCT FROM CASE WHEN s.tenure = 'OSPITATA' THEN s.host_organization_id END
    OR e.ownership IS DISTINCT FROM CASE WHEN s.tenure = 'OSPITATA' THEN 'OSPITATA' ELSE 'PROPRIA' END;
CREATE OR REPLACE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.address, s.city, s.province, s.active, s.kind, s.organization_id,
         (e.site_id IS NOT NULL) AS configured,
         e.company_id, e.cash_float,
         core_operating_days(s.opening_hours_json) AS operating_days,
         (s.opening_hours_json IS NOT NULL AND core_operating_days(s.opening_hours_json) <> '0000000' AND core_hours(s.opening_hours_json) <> '{}'::jsonb) AS hours_from_core,
         e.pos_terminals,
         coalesce(s.opened_at, e.created_at::date) AS start_date, s.opened_at,
         CASE WHEN s.tenure = 'OSPITATA' THEN 'OSPITATA' ELSE 'PROPRIA' END AS ownership,
         s.tenure,
         core_hours(s.opening_hours_json) AS hours, s.opening_hours AS hours_note,
         e.expected_registers, s.email AS site_email,
         CASE WHEN s.tenure = 'OSPITATA' THEN s.host_organization_id END AS host_org_id,
         ho.name AS host_name, ho.vat_number AS host_vat, ho.email AS host_email,
         e.royalty_fixed_monthly, e.royalty_pct, e.royalty_base, e.royalty_vat_rate, e.royalty_notes,
         e.created_at, e.updated_at
    FROM public.sites s
    LEFT JOIN site_ext e ON e.site_id = s.id
    LEFT JOIN public.organizations ho ON ho.id = CASE WHEN s.tenure = 'OSPITATA' THEN s.host_organization_id END
   WHERE s.kind IS DISTINCT FROM 'SERVICE';
INSERT INTO public.audit_log (action, module_key, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'cash', 'migration', 'cash/016_titolo_solo_dal_core.sql',
       'Cash: titolo e ospitante solo dal core (A2)', jsonb_object_agg(voce, n) FROM _a2_rapporto;
