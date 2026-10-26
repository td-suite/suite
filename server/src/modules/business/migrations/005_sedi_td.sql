-- Organizzazioni e sedi (decisione del CEO, 26/10/2026): contratti e fascicoli si agganciano sia alle Legal entity
-- (public.organizations, la controparte) sia alle sedi di Toscana Diagnostica (public.sites con kind <> 'SERVICE'),
-- e dove ha senso a entrambe (il contratto del punto prelievi lega la sede TD al partner che la ospita). Almeno uno dei
-- due riferimenti è obbligatorio. Nessuna copia dell'anagrafica: solo chiavi esterne verso public.*.
-- I dati esistenti non si perdono: la controparte resta, i fascicoli ereditano controparte e sede dal contratto.

-- Contratti: la controparte diventa facoltativa (resta obbligatoria la sede per punti prelievo e sedi TD in locazione)
ALTER TABLE contracts ALTER COLUMN org_id DROP NOT NULL;
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_party_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_party_check CHECK (org_id IS NOT NULL OR site_id IS NOT NULL);

-- Fascicoli di autorizzazione: riferimenti propri alla controparte e alla sede TD (l'autorizzazione sanitaria è della
-- singola sede). Il contratto di origine diventa facoltativo: un fascicolo può nascere anche da una sede TD senza contratto
-- (sede di proprietà, laboratorio). Chi ha un contratto resta allineato: un fascicolo per contratto.
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS org_id  INT REFERENCES public.organizations(id);
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS site_id INT REFERENCES public.sites(id);
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS title   TEXT;
ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id);
UPDATE dossiers d SET org_id = c.org_id, site_id = c.site_id FROM contracts c WHERE c.id = d.contract_id AND d.org_id IS NULL AND d.site_id IS NULL;
ALTER TABLE dossiers ALTER COLUMN contract_id DROP NOT NULL;
ALTER TABLE dossiers DROP CONSTRAINT IF EXISTS dossiers_party_check;
ALTER TABLE dossiers ADD CONSTRAINT dossiers_party_check CHECK (org_id IS NOT NULL OR site_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS dossiers_org_idx ON dossiers (org_id);
CREATE INDEX IF NOT EXISTS dossiers_site_idx ON dossiers (site_id);
