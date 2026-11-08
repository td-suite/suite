-- Circolari interne: una sola serie (richiesta del CEO, 08/11/2026). Una circolare pubblicata in Comunicazione prende il protocollo
-- TD-AAAA/NNN dal registro del modulo Circolari ed entra nel suo archivio (server/src/modules/circolari/lib/ponte.js).
-- circolare_id: chiave esterna LOGICA verso circolari.circolari(id) (lo schema del modulo esiste solo dopo "Avvia il modulo": niente FK
-- fisica); punta all'ultima revisione registrata. protocol_legacy: protocollo provvisorio CIRC-AAAA-NNN conservato quando la circolare
-- viene portata nel registro (Amministrazione > Diagnostica, controllo D42 "Registra").
-- Idempotente e non distruttiva: solo colonne nuove e un indice.
ALTER TABLE news ADD COLUMN IF NOT EXISTS circolare_id INT;
ALTER TABLE news ADD COLUMN IF NOT EXISTS protocol_legacy TEXT;
CREATE INDEX IF NOT EXISTS news_circolare_idx ON news (circolare_id) WHERE circolare_id IS NOT NULL;
