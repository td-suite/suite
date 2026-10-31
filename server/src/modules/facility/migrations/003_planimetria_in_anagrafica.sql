-- Planimetria nell'anagrafica Sedi (richiesta del CEO, 31/10/2026): la fonte unica diventa public.site_documents kind 'PLANIMETRIA'
-- (migrazione core 036), caricata da Amministrazione > Sedi o dalla scheda dell'immobile con la stessa funzione (lib/roomPlan.js).
-- Le planimetrie già caricate in Facility passano lì una volta sola: stessi byte (bytea) o stesso percorso nel blob (nessuna copia del
-- file), data di caricamento, autore e data di pubblicazione in Room. Idempotente: non ricopia ciò che c'è già (stessa sede, nome e
-- impronta). Poi il kind PLANIMETRIA esce dai documenti Facility (restano CONTRATTO, CERTIFICAZIONE, VERBALE, ALTRO).
INSERT INTO public.site_documents (site_id, kind, filename, mime, size, sha256, data, blob_path, uploaded_by, created_at, published_room_at, source)
SELECT p.site_id, 'PLANIMETRIA', d.filename, d.mime, d.size, coalesce(d.sha256, md5(coalesce(d.blob_path, d.filename))), d.data, d.blob_path,
       d.uploaded_by, d.created_at, d.published_room_at, 'migrazione Facility'
  FROM facility.property_documents d
  JOIN facility.properties p ON p.id = d.property_id
  JOIN public.sites s ON s.id = p.site_id
 WHERE d.kind = 'PLANIMETRIA'
   AND NOT EXISTS (SELECT 1 FROM public.site_documents x WHERE x.site_id = p.site_id AND x.kind = 'PLANIMETRIA'
                     AND x.filename = d.filename AND x.sha256 IS NOT DISTINCT FROM coalesce(d.sha256, md5(coalesce(d.blob_path, d.filename))));

-- solo la più recente di ogni sede resta segnata come pubblicata in Room (è quella che Room mostra)
UPDATE public.site_documents x SET published_room_at = NULL
 WHERE x.kind = 'PLANIMETRIA' AND x.published_room_at IS NOT NULL
   AND EXISTS (SELECT 1 FROM public.site_documents y WHERE y.site_id = x.site_id AND y.kind = 'PLANIMETRIA' AND (y.created_at, y.id) > (x.created_at, x.id));

DELETE FROM facility.property_documents WHERE kind = 'PLANIMETRIA';
ALTER TABLE facility.property_documents DROP CONSTRAINT IF EXISTS property_documents_kind_check;
ALTER TABLE facility.property_documents ADD CONSTRAINT property_documents_kind_check CHECK (kind IN ('CONTRATTO','CERTIFICAZIONE','VERBALE','ALTRO'));
