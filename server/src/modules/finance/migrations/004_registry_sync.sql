-- Fonte unica con l'anagrafica Sedi (richiesta del CEO, 31/10/2026: "mettilo a disposizione di payments per lo scadenziario pagamenti,
-- in modo da non replicare l'azione"). Titolo di godimento, canone, durata, garanzie e contratto in PDF si inseriscono in
-- Amministrazione > Sedi (public.sites, public.site_documents); server/src/lib/leaseSync.js crea o aggiorna qui il contratto della sede
-- e, viceversa, porta in anagrafica un contratto creato in Payments. Gli scatti successivi (ISTAT, rinegoziazioni) restano di Payments.

-- Contratto allineato con l'anagrafica Sedi: al massimo uno attivo per sede
ALTER TABLE lease_contracts ADD COLUMN IF NOT EXISTS registry_sync BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX IF NOT EXISTS lease_contracts_registry_uq ON lease_contracts (site_id) WHERE registry_sync AND active;
UPDATE lease_contracts l SET registry_sync = TRUE
  FROM (SELECT DISTINCT ON (site_id) id FROM lease_contracts WHERE active ORDER BY site_id, start_date DESC, id DESC) x
 WHERE x.id = l.id AND NOT EXISTS (SELECT 1 FROM lease_contracts y WHERE y.site_id = l.site_id AND y.registry_sync AND y.active);

-- Scatto aggiunto dall'anagrafica quando il canone cambia in Sedi dopo scatti già registrati in Payments
ALTER TABLE lease_steps DROP CONSTRAINT IF EXISTS lease_steps_reason_check;
ALTER TABLE lease_steps ADD CONSTRAINT lease_steps_reason_check CHECK (reason IN ('INIZIALE','ISTAT','RINEGOZIAZIONE','ALTRO','ANAGRAFICA'));

-- PDF caricato in Sedi: la riga di Payments non ha byte propri, punta al file dell'anagrafica (public.site_documents)
ALTER TABLE lease_documents ADD COLUMN IF NOT EXISTS site_document_id INT REFERENCES public.site_documents(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS lease_documents_site_doc_uq ON lease_documents (lease_id, site_document_id) WHERE site_document_id IS NOT NULL;
