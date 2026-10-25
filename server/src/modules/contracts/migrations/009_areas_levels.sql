-- Aree su tre livelli (1° livello, 2° livello "di", 3° livello "di"), come l'organigramma SGI
ALTER TABLE areas ADD COLUMN parent_id INT REFERENCES areas(id) ON DELETE SET NULL;
ALTER TABLE areas ADD COLUMN level INT NOT NULL DEFAULT 1;
UPDATE areas c SET parent_id=p.id, level=2 FROM areas p WHERE p.name='Direzione Generale' AND c.name IN ('Operations','Finance','Legal, People and Organization','Flow & Back Office Management','Retail & Communications Management','HSQ Management','Direzione Sanitaria');
UPDATE areas c SET parent_id=p.id, level=2 FROM areas p WHERE p.name='Laboratorio di Analisi' AND c.name IN ('Direzione Tecnica','Lab Operations','Preanalitica','Core Lab','Microbiologia','Biologia Molecolare','Anatomia Patologica');
-- Vista con percorso completo e area di 1° livello
CREATE OR REPLACE VIEW areas_tree AS
WITH RECURSIVE t AS (
  SELECT id, name, parent_id, level, sort_order, id AS root_id, name AS root_name, name::text AS path, ARRAY[sort_order] AS sort_path
  FROM areas WHERE parent_id IS NULL
  UNION ALL
  SELECT a.id, a.name, a.parent_id, a.level, a.sort_order, t.root_id, t.root_name, t.path || ' › ' || a.name, t.sort_path || a.sort_order
  FROM areas a JOIN t ON a.parent_id = t.id
)
SELECT * FROM t;
