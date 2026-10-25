-- Laboratorio di Analisi come nell'organigramma SGI: Direzione Tecnica (Balzano) guida le unità del laboratorio;
-- Lab Operations Management (Arrighetti) è tecnostruttura della Direzione Tecnica. Quarto livello ammesso.
UPDATE areas c SET parent_id=p.id, level=4 FROM areas p WHERE p.name='Direzione Tecnica' AND c.name IN ('Lab Operations Management','Preanalitica','Core Lab','Microbiologia','Biologia Molecolare','Anatomia Patologica')
  AND c.parent_id=(SELECT id FROM areas WHERE name='Laboratorio di Analisi');
UPDATE areas SET kind='STAFF' WHERE name='Lab Operations Management';
-- ricalcolo dei livelli su tutto l'albero
WITH RECURSIVE t AS (SELECT id, 1 AS lvl FROM areas WHERE parent_id IS NULL UNION ALL SELECT a.id, t.lvl+1 FROM areas a JOIN t ON a.parent_id=t.id)
UPDATE areas x SET level=t.lvl FROM t WHERE x.id=t.id AND x.level<>t.lvl;
