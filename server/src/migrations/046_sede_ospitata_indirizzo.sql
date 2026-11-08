-- Sede OSPITATA = indirizzo della Legal entity ospitante (CEO, 08/11/2026: "Quando una sede è ospitata da una legal entity deve
-- prendere indirizzo della legal entity"). Non distruttiva: riempie SOLO le sedi ospitate senza indirizzo; quelle con un indirizzo
-- diverso dall'ospitante restano come sono e si correggono da Amministrazione > Diagnostica anagrafica (D03b, "Prendi l'indirizzo
-- dell'ospitante"). Idempotente.
CREATE TEMP TABLE IF NOT EXISTS _m046 (voce TEXT, n INT) ON COMMIT DROP;

WITH agg AS (
  UPDATE sites s SET address = o.address, zip = o.zip, city = o.city, province = left(o.province, 4), address_from_org = TRUE, updated_at = now()
  FROM organizations o
  WHERE o.id = s.host_organization_id AND s.tenure = 'OSPITATA' AND coalesce(s.address, '') = '' AND coalesce(s.city, '') = ''
    AND (o.address IS NOT NULL OR o.city IS NOT NULL)
  RETURNING s.id)
INSERT INTO _m046 SELECT 'sedi_ospitate_indirizzo_riempito', count(*)::int FROM agg;

INSERT INTO _m046 SELECT 'sedi_ospitate_indirizzo_diverso_da_correggere_D03b', count(*)::int FROM sites s JOIN organizations o ON o.id = s.host_organization_id
  WHERE s.active AND s.tenure = 'OSPITATA' AND (o.address IS NOT NULL OR o.city IS NOT NULL)
    AND (lower(coalesce(s.address,'')) <> lower(coalesce(o.address,'')) OR lower(coalesce(s.city,'')) <> lower(coalesce(o.city,'')) OR coalesce(s.zip,'') <> coalesce(o.zip,''));

INSERT INTO audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', '046_sede_ospitata_indirizzo.sql', 'Sedi ospitate: indirizzo della Legal entity ospitante',
       coalesce(jsonb_object_agg(voce, n), '{}'::jsonb) FROM _m046;
