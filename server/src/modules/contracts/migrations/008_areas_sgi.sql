-- Aree aziendali allineate all'organigramma TD-SGI-IDL007_01: rinomina delle aree esistenti, nuove aree, pulizia di quelle vuote
UPDATE areas SET name='Network Punti Prelievo' WHERE name='Punti Prelievo e Accettazione';
UPDATE areas SET name='Diagnostic Center' WHERE name='Diagnostica per Immagini';
UPDATE areas SET name='Legal, People and Organization' WHERE name='People & Culture';
UPDATE areas SET name='Finance' WHERE name='Finance e Amministrazione';
UPDATE areas SET name='Retail & Communications Management' WHERE name='Retail e Comunicazione';
UPDATE areas SET name='HSQ Management' WHERE name IN ('Qualità, Sicurezza e SGI','Qualità Sicurezza e SGI');
UPDATE areas SET name='Operations' WHERE name='Procurement e Logistica';
UPDATE areas SET name='B2B' WHERE name='Medicina del Lavoro';
-- aree non presenti nell'organigramma: eliminate se vuote, altrimenti spostate in Direzione Generale
UPDATE resources SET area_id=(SELECT id FROM areas WHERE name='Direzione Generale') WHERE area_id IN (SELECT id FROM areas WHERE name IN ('Medicina Specialistica','Legale','IT e Sistemi Informativi'));
UPDATE org_units SET area_id=NULL WHERE area_id IN (SELECT id FROM areas WHERE name IN ('Medicina Specialistica','Legale','IT e Sistemi Informativi'));
DELETE FROM areas WHERE name IN ('Medicina Specialistica','Legale','IT e Sistemi Informativi');
-- nuove aree dell'organigramma
INSERT INTO areas(name, sort_order) SELECT n, o FROM (VALUES
  ('Direzione Generale',10),('Operations',20),('Finance',30),('Legal, People and Organization',40),('Flow & Back Office Management',50),('Retail & Communications Management',60),('HSQ Management',70),
  ('Laboratorio di Analisi',80),('Direzione Tecnica',90),('Lab Operations',100),('Preanalitica',110),('Core Lab',120),('Microbiologia',130),('Biologia Molecolare',140),('Anatomia Patologica',150),
  ('Network Punti Prelievo',160),('B2B',170),('Diagnostic Center',180),('Direzione Sanitaria',190)) AS v(n,o)
  ON CONFLICT (name) DO UPDATE SET sort_order=EXCLUDED.sort_order, active=TRUE;
-- unità dell'organigramma agganciate all'area omonima
UPDATE org_units u SET area_id=a.id FROM areas a WHERE a.name=u.name;
UPDATE org_units u SET area_id=a.id FROM areas a WHERE u.role_title='Direttore Sanitario' AND a.name='Direzione Sanitaria';
