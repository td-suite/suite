-- v0.68.3 (10/11/2026): punto di consegna per le Legal entity cliente con più sedi SERVICE e abbinamento automatico delle destinazioni Silva.
-- Regola che resta (decisione A4 dell'anagrafica unica): ordini, giacenze, produzione e dotazione stanno sulla Legal entity cliente;
-- cambia solo la CONSEGNA. Idempotente e non distruttiva: solo colonne nuove, indici e una vista.
--  - orders.delivery_site_id: punto SERVICE (public.sites, kind SERVICE, della Legal entity dell'ordine) a cui consegnare. Riferimento
--    logico senza chiave esterna rigida: l'eliminazione di una sede in Amministrazione non deve fallire per un ordine storico, e la
--    Suite controlla l'appartenenza al momento della scelta (lib/punti.js). NULL = consegna all'indirizzo della Legal entity (come prima).
--  - packages.delivery_site_id: punto dell'ordine annotato sulle confezioni al carico della consegna (solo informativo: la giacenza resta
--    della Legal entity, la giacenza per punto NON è gestita).
--  - site_ext / org_ext .silva_match ('AUTO' | 'MANUALE' | 'ESCLUSA' = tolta a mano, non si rimette in automatico) e silva_match_at.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_site_id INT;
CREATE INDEX IF NOT EXISTS orders_delivery_site_idx ON orders (delivery_site_id) WHERE delivery_site_id IS NOT NULL;
ALTER TABLE packages ADD COLUMN IF NOT EXISTS delivery_site_id INT;
ALTER TABLE site_ext ADD COLUMN IF NOT EXISTS silva_match TEXT;
ALTER TABLE site_ext ADD COLUMN IF NOT EXISTS silva_match_at TIMESTAMPTZ;
ALTER TABLE org_ext ADD COLUMN IF NOT EXISTS silva_match TEXT;
ALTER TABLE org_ext ADD COLUMN IF NOT EXISTS silva_match_at TIMESTAMPTZ;
-- le destinazioni già scelte prima della 0.68.3 sono state confermate a mano (proposta + conferma)
UPDATE site_ext SET silva_match = 'MANUALE' WHERE silva_match IS NULL AND silva_code ~ '^[1-9][0-9]*$';
UPDATE org_ext SET silva_match = 'MANUALE' WHERE silva_match IS NULL AND silva_code ~ '^[1-9][0-9]*$';

-- Unità da abbinare a una destinazione Silva (chi riceve merce):
--  SEDE   sedi TD attive (non i punti SERVICE); la Direzione (HEADQUARTER) solo se ha già una destinazione o degli ordini;
--  LE     Legal entity cliente attive in Ordini SENZA punti SERVICE attivi (consegna all'indirizzo della Legal entity);
--  PUNTO  ogni punto SERVICE attivo delle Legal entity cliente attive in Ordini (la Legal entity con punti non si abbina).
-- id = chiave della vista strutture_v (sede o punto: id della sede; Legal entity: -org_id): è anche la chiave di PUT /strutture/:id.
CREATE OR REPLACE VIEW silva_unita_v AS
SELECT s.id, 'SEDE'::text AS tipo, s.name AS label, s.name, NULL::text AS organization_name, s.code, s.address, s.zip, s.city, s.province,
    s.silva_code, e.silva_match, e.silva_match_at, s.site_kind, s.origin
  FROM strutture_v s LEFT JOIN site_ext e ON e.site_id = s.site_id
 WHERE s.origin = 'SITE' AND s.active AND NOT s.delivery_point
   AND (coalesce(s.site_kind, '') <> 'HEADQUARTER' OR s.silva_code IS NOT NULL OR EXISTS (SELECT 1 FROM orders x WHERE x.struttura_id = s.id))
UNION ALL
SELECT l.id, 'LE'::text, l.name, l.name, l.name, l.code, l.address, l.zip, l.city, l.province,
    l.silva_code, e.silva_match, e.silva_match_at, NULL::text, l.origin
  FROM strutture_v l LEFT JOIN org_ext e ON e.org_id = l.org_id
 WHERE l.origin = 'ORG' AND l.active
   AND NOT EXISTS (SELECT 1 FROM public.sites p WHERE p.organization_id = l.org_id AND p.kind = 'SERVICE' AND p.active)
UNION ALL
SELECT p.id, 'PUNTO'::text, l.name || ' · ' || p.name, p.name, l.name, p.code, p.address, p.zip, p.city, p.province,
    p.silva_code, e.silva_match, e.silva_match_at, p.site_kind, p.origin
  FROM strutture_v p JOIN strutture_v l ON l.origin = 'ORG' AND l.org_id = p.organization_id AND l.active
  LEFT JOIN site_ext e ON e.site_id = p.site_id
 WHERE p.origin = 'SITE' AND p.delivery_point AND p.active;
