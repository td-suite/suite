-- Planimetria della sede (richiesta del CEO, 31/10/2026: "Da dove carico il PDF della planimetria su Amministrazione/Sedi? Per poi
-- metterlo a disposizione di tutta la SUITE?"). Fonte unica: public.site_documents con kind 'PLANIMETRIA' (PDF o immagine PNG, JPEG,
-- WebP). La corrente è la più recente della sede, le precedenti restano come storico scaricabile. Si carica da Amministrazione > Sedi o
-- dalla scheda dell'immobile in Facility (stessa tabella, stessa funzione lib/roomPlan.js) e si pubblica in Room Planning
-- (room.struttura_blobs planPdf / planImg). published_room_at: quando la versione è stata pubblicata in Room (solo la corrente lo ha).
-- Le planimetrie già caricate in Facility (facility.property_documents) passano qui con la migrazione facility/003.
ALTER TABLE site_documents DROP CONSTRAINT IF EXISTS site_documents_kind_check;
ALTER TABLE site_documents ADD CONSTRAINT site_documents_kind_check CHECK (kind IN ('CONTRATTO_LOCAZIONE','PLANIMETRIA','ALTRO'));
ALTER TABLE site_documents ADD COLUMN IF NOT EXISTS published_room_at TIMESTAMPTZ;
ALTER TABLE site_documents ADD COLUMN IF NOT EXISTS source TEXT;   -- da dove è stata caricata: 'Amministrazione > Sedi', 'Facility', 'migrazione Facility'
