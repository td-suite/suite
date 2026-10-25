-- Referente di ogni area (per l'organigramma generato dai ruoli registrati); se assente viene derivato dalle linee di riporto
ALTER TABLE areas ADD COLUMN head_resource_id INT REFERENCES resources(id) ON DELETE SET NULL;

-- Referenti dall'organigramma TD-SGI-IDL007 (impostati solo se la persona è in anagrafica e l'area esiste)
UPDATE areas a SET head_resource_id = r.id
  FROM (VALUES
    ('Direzione Generale','Francesco','Epifani'),
    ('Operations','Valentina','Zezza'),
    ('Finance','Vincenzo','Malenchini'),
    ('Legal, People and Organization','Angelica','Corradi'),
    ('Flow & Back Office Management','Rosetta','Greco'),
    ('Retail & Communications Management','Silvia','Sansoni'),
    ('HSQ Management','Iacopo','Cupelli'),
    ('Laboratorio di Analisi','Valentina','Zezza'),
    ('Direzione Tecnica','Maria Teresa','Balzano'),
    ('Lab Operations Management','Sara','Arrighetti'),
    ('Preanalitica','Sara','Arrighetti'),
    ('Core Lab','Antonia','Esposito'),
    ('Microbiologia','Chiara','Chilleri'),
    ('Biologia Molecolare','Silvia','Quattrone'),
    ('Anatomia Patologica','Cristina','Fondi'),
    ('Network Punti Prelievo','Silvia','Sansoni'),
    ('B2B','Valentina','Cesati'),
    ('Diagnostic Center','Rosetta','Greco')
  ) AS v(area, first_name, last_name)
  JOIN resources r ON r.first_name = v.first_name AND r.last_name = v.last_name AND r.status <> 'CESSATO'
  WHERE a.head_resource_id IS NULL AND a.name = v.area;
