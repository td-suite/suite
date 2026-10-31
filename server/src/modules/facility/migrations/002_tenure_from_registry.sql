-- Titolo di godimento e locatore dall'anagrafica Sedi (richiesta del CEO, 31/10/2026: "l'area immobili NON legge bene le sedi in
-- amministrazione dal punto di vista di locazione/ospitata. Montemurlo, Poggio a Caiano, Calenzano e altri sono ospitati ma nella
-- finestra immobili figurano come Locazione!"). properties.tenure e properties.landlord_org_id erano un doppione dell'anagrafica:
-- l'immobile nasceva LOCAZIONE per ogni sede senza ospitante e il locatore era la Legal entity ospitante. Da ora Facility legge
-- public.sites.tenure e public.sites.lease_landlord_org_id (Amministrazione > Sedi, migrazione core 034). Prima di togliere le colonne,
-- i valori scelti a mano in Facility (proprietà o comodato di una sede non ospitata, locatore diverso dall'ospitante) passano in anagrafica.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'properties' AND column_name = 'tenure') THEN
    UPDATE public.sites s SET tenure = p.tenure
      FROM properties p
     WHERE p.site_id = s.id AND p.tenure IN ('PROPRIETA','COMODATO') AND s.host_organization_id IS NULL AND s.tenure = 'LOCAZIONE' AND s.rent_amount IS NULL;
    ALTER TABLE properties DROP COLUMN tenure;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'properties' AND column_name = 'landlord_org_id') THEN
    UPDATE public.sites s SET lease_landlord_org_id = p.landlord_org_id
      FROM properties p
     WHERE p.site_id = s.id AND p.landlord_org_id IS NOT NULL AND p.landlord_org_id IS DISTINCT FROM s.host_organization_id
       AND s.lease_landlord_org_id IS NULL AND s.tenure IN ('LOCAZIONE','COMODATO');
    ALTER TABLE properties DROP COLUMN landlord_org_id;
  END IF;
END $$;
