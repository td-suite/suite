-- Circolari v0.98.0 (CEO, 25/11/2026): più firmatari per circolare, con i loro contatti in fondo; documenti del SGI agganciati alla
-- circolare e uniti al PDF. firma_nome e firma_ruolo restano il primo firmatario (compatibilità). Idempotente, non distruttiva.
ALTER TABLE circolari ADD COLUMN IF NOT EXISTS firmatari JSONB NOT NULL DEFAULT '[]';      -- [{ nome, ruolo, email, telefono }]
ALTER TABLE circolari ADD COLUMN IF NOT EXISTS allegati_sgi JSONB NOT NULL DEFAULT '[]';   -- [{ code, titolo, file }] file = percorso nello specchio del SGI
ALTER TABLE circolari ADD COLUMN IF NOT EXISTS allegati_esito JSONB;                       -- esito dell'unione all'ultima impaginazione
UPDATE circolari SET firmatari = jsonb_build_array(jsonb_build_object('nome', firma_nome, 'ruolo', coalesce(firma_ruolo, ''), 'email', '', 'telefono', ''))
 WHERE firmatari = '[]'::jsonb AND coalesce(firma_nome, '') <> '';
