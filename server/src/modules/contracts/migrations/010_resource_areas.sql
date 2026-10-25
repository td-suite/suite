-- Doppie funzioni: una risorsa può appartenere a più aree (area_id resta quella principale)
CREATE TABLE resource_areas (
  resource_id INT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  area_id     INT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (resource_id, area_id)
);
CREATE INDEX resource_areas_area_idx ON resource_areas(area_id);

-- Allineamento all'organigramma SGI per chi guida due unità
UPDATE resources r SET area_id=a.id FROM areas a WHERE a.name='Operations' AND r.last_name='Zezza' AND r.first_name='Valentina';
UPDATE resources r SET area_id=a.id FROM areas a WHERE a.name='Flow & Back Office Management' AND r.last_name='Greco' AND r.first_name='Rosetta';
UPDATE resources r SET area_id=a.id FROM areas a WHERE a.name='Retail & Communications Management' AND r.last_name='Sansoni' AND r.first_name='Silvia';
INSERT INTO resource_areas(resource_id, area_id)
  SELECT r.id, a.id FROM resources r, areas a WHERE a.name='Laboratorio di Analisi' AND r.last_name='Zezza' AND r.first_name='Valentina'
  UNION SELECT r.id, a.id FROM resources r, areas a WHERE a.name='Diagnostic Center' AND r.last_name='Greco' AND r.first_name='Rosetta'
  UNION SELECT r.id, a.id FROM resources r, areas a WHERE a.name='Network Punti Prelievo' AND r.last_name='Sansoni' AND r.first_name='Silvia'
ON CONFLICT DO NOTHING;

-- Riorganizzazione: tutto dipende da Direzione Generale (unica area di 1° livello);
-- le linee (Laboratorio di Analisi, Network Punti Prelievo, B2B, Diagnostic Center) sono di 2° livello,
-- le unità del laboratorio di 3° livello.
UPDATE areas c SET parent_id=p.id, level=2 FROM areas p WHERE p.name='Direzione Generale' AND c.name IN ('Laboratorio di Analisi','Network Punti Prelievo','B2B','Diagnostic Center');
UPDATE areas c SET parent_id=p.id, level=3 FROM areas p WHERE p.name='Laboratorio di Analisi' AND c.parent_id=p.id;
UPDATE areas SET name='Lab Operations Management' WHERE name='Lab Operations';
