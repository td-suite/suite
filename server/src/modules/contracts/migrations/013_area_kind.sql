-- Tecnostruttura (funzioni di staff) vs aree operative (linee): disegno dell'organigramma
ALTER TABLE areas ADD COLUMN kind TEXT NOT NULL DEFAULT 'LINEA' CHECK (kind IN ('STAFF','LINEA'));
UPDATE areas SET kind='STAFF' WHERE name IN ('Operations','Finance','Legal, People and Organization','Flow & Back Office Management','Retail & Communications Management','HSQ Management','Direzione Sanitaria');
