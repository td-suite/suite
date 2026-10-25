-- Come in Contratti del personale: tecnostruttura (funzioni di staff, in alto) e aree operative (il pettine dell'organizzazione)
ALTER TABLE org_units ADD COLUMN IF NOT EXISTS branch TEXT NOT NULL DEFAULT 'LINEA' CHECK (branch IN ('LINEA','STAFF'));
UPDATE org_units SET branch='STAFF' WHERE kind IN ('AREA','FUNZIONE') AND lower(name) IN (
  'operations','finance','finance management','legal, people and organization','chief of legal, people and organization','flow & back office management','retail & communications management',
  'hsq management','direzione sanitaria','lab operations management','lab operations','direzione tecnica','amministrazione','segreteria');
