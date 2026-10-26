-- Tecnostruttura riconosciuta anche dai nomi scelti a mano (es. "Finance Management", "Direzione Sanitaria"), solo dove non già impostata a mano
UPDATE org_units SET branch='STAFF' WHERE kind IN ('AREA','FUNZIONE') AND branch='LINEA' AND (
  lower(name) LIKE 'finance%' OR lower(name) LIKE 'operations%' OR lower(name) LIKE 'legal%' OR lower(name) LIKE 'people%' OR lower(name) LIKE 'flow%'
  OR lower(name) LIKE 'retail & comm%' OR lower(name) LIKE 'hsq%' OR lower(name) LIKE 'hqs%' OR lower(name) LIKE 'qualit%' OR lower(name) LIKE 'direzione sanitaria%'
  OR lower(name) LIKE 'direzione tecnica%' OR lower(name) LIKE 'lab operations%' OR lower(name) LIKE 'amministrazione%' OR lower(name) LIKE 'segreteria%' OR lower(name) LIKE 'it %' OR lower(name) = 'it');
