-- Circolari v0.97.3 (CEO, 25/11/2026): una circolare può avere PIÙ destinatari (clienti service e punti prelievo, per esempio).
-- circolari.segmenti = elenco dei segmenti; circolari.segmento resta il primo dell'elenco (compatibilità con ciò che lo legge).
-- Un trigger tiene allineate le due colonne qualunque sia il punto del programma che scrive. Idempotente, non distruttiva.
ALTER TABLE circolari ADD COLUMN IF NOT EXISTS segmenti TEXT[];
UPDATE circolari SET segmenti = ARRAY[segmento] WHERE segmenti IS NULL OR cardinality(segmenti) = 0;
CREATE OR REPLACE FUNCTION circolari_segmenti_allinea() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.segmenti IS NOT DISTINCT FROM OLD.segmenti AND NEW.segmento IS DISTINCT FROM OLD.segmento THEN
    NEW.segmenti := ARRAY[NEW.segmento];              -- chi cambia solo il segmento (codice precedente) sostituisce l'elenco
  ELSIF NEW.segmenti IS NULL OR cardinality(NEW.segmenti) = 0 THEN
    NEW.segmenti := ARRAY[NEW.segmento];
  ELSIF NOT (NEW.segmento = ANY(NEW.segmenti)) THEN
    NEW.segmento := NEW.segmenti[1];
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS circolari_segmenti_trg ON circolari;
CREATE TRIGGER circolari_segmenti_trg BEFORE INSERT OR UPDATE ON circolari FOR EACH ROW EXECUTE FUNCTION circolari_segmenti_allinea();
CREATE INDEX IF NOT EXISTS circolari_segmenti_idx ON circolari USING gin (segmenti);
