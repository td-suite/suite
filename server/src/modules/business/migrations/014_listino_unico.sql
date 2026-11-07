-- Business Hub · un solo listino tra la scheda Contratto e la scheda Listino e offerta (richiesta del CEO del 07/11/2026: "che sia alla
-- scheda del contratto o qui l'upload del file XLSX deve essere lo stesso file"). La sorgente è la versione del listino dell'account
-- (tabella listini); nel contratto Service della linea il file XLSX della versione (LISTINO_XLSX) e l'offerta economica PDF generata
-- (LISTINO_PDF) sono copie collegate alla versione: listino_id dice da quale versione vengono. Un file senza listino_id è storico
-- (caricato prima del 07/11/2026 o in un contratto senza account). Docs: docs/BUSINESS_HUB.md, "Listino unico".
ALTER TABLE contract_files ADD COLUMN IF NOT EXISTS listino_id INT REFERENCES listini(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS contract_files_listino_idx ON contract_files (listino_id) WHERE listino_id IS NOT NULL;
