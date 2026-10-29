-- Legal entity ospitante della sede (richiesta del CEO, 29/10/2026): il Punto Prelievi di Quarrata è di Toscana Diagnostica S.r.l.
-- (organization_id) ma è ospitato da G.B. Center (host_organization_id). È la stessa Legal entity con cui il partner accede alla
-- Suite (profilo "Partner ospitante"): il suo perimetro Cash sono le sedi che lo hanno come ospitante. Fonte unica nell'anagrafica;
-- cash.site_ext.host_org_id resta allineato dal server (lettura con coalesce, scrittura in entrambi i punti).
ALTER TABLE sites ADD COLUMN IF NOT EXISTS host_organization_id INT REFERENCES organizations(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS sites_host_org_idx ON sites (host_organization_id);
DO $$ BEGIN
  IF to_regclass('cash.site_ext') IS NOT NULL THEN
    UPDATE sites s SET host_organization_id = e.host_org_id FROM cash.site_ext e WHERE e.site_id = s.id AND e.host_org_id IS NOT NULL AND s.host_organization_id IS NULL;
  END IF;
END $$;
