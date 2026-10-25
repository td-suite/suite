-- Allinea i vincoli dei database creati con le prime versioni (prima della sezione Sedi TD in locazione e dello stato Cessato),
-- dove 001_init.sql non conteneva ancora 'SEDE', 'CESSATO', 'PLANIMETRIA' e 'ASSICURAZIONE'. Idempotente.
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_kind_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_kind_check CHECK (kind IN ('PP','SRV','MDL','SEDE'));
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_status_check CHECK (status IN ('BOZZA','PROPOSTA','FIRMATO','AUTORIZZATO','ATTIVO','CESSATO','ANNULLATO'));
ALTER TABLE contract_files DROP CONSTRAINT IF EXISTS contract_files_category_check;
ALTER TABLE contract_files ADD CONSTRAINT contract_files_category_check CHECK (category IN ('GENERATO_DOCX','GENERATO_PDF','FIRMATO','LISTINO_XLSX','LISTINO_PDF','PLANIMETRIA','ASSICURAZIONE','ALTRO'));
