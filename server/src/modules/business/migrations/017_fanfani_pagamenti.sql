-- 07/11/2026 (CEO, dopo una lettera al cliente con "(lettera di offerta Fanfani)" nei termini di pagamento): nessun riferimento alla
-- gestione precedente nei dati del Business Hub; i termini di pagamento della lettera hanno un'unica fonte, le Impostazioni Business
-- della Legal entity (org_ext.pay_method + pay_terms): il testo proprio del contratto (data.payment_terms) sparisce.
-- 1) i testi particolari dei contratti (non standard) passano alla Legal entity, così nulla va perso
INSERT INTO org_ext (org_id) SELECT DISTINCT c.org_id FROM contracts c WHERE c.org_id IS NOT NULL AND c.data ? 'payment_terms'
  AND NOT EXISTS (SELECT 1 FROM org_ext x WHERE x.org_id=c.org_id);
UPDATE org_ext x SET pay_terms = t.pt FROM (
  SELECT DISTINCT ON (c.org_id) c.org_id, c.data->>'payment_terms' AS pt FROM contracts c
  WHERE c.org_id IS NOT NULL AND c.status <> 'ANNULLATO' AND coalesce(c.data->>'payment_terms','') <> ''
    AND c.data->>'payment_terms' !~* '^bonifico bancario (30|60) gg fm da emissione fattura( \(lettera di offerta fanfani\))?$'
  ORDER BY c.org_id, c.updated_at DESC NULLS LAST, c.id DESC) t
WHERE x.org_id = t.org_id;
-- 2) normalizzazione delle frasi standard e pulizia dei riferimenti
UPDATE org_ext SET pay_method = 'Bonifico bancario', pay_terms = '30 gg f.m. data fattura'
  WHERE pay_terms ~* '^bonifico bancario 30 gg fm da emissione fattura' OR pay_terms IS NULL OR btrim(pay_terms) = '' OR pay_terms = '30 gg fm';
UPDATE org_ext SET pay_method = 'Bonifico bancario', pay_terms = '60 gg f.m. data fattura' WHERE pay_terms ~* '^bonifico bancario 60 gg fm da emissione fattura';
UPDATE org_ext SET pay_method = 'Bonifico bancario' WHERE pay_method IS NULL OR btrim(pay_method) = '';
UPDATE org_ext SET pay_terms = btrim(regexp_replace(pay_terms, '\s*\(lettera di offerta Fanfani\)', '', 'gi')) WHERE pay_terms ILIKE '%fanfani%';
UPDATE org_ext SET pay_terms = regexp_replace(pay_terms, 'Fanfani', 'gestione precedente', 'gi') WHERE pay_terms ILIKE '%fanfani%';
UPDATE contracts SET data = data - 'payment_terms' WHERE data ? 'payment_terms';
-- 3) testi: note dei contratti, delle organizzazioni, degli account e del diario
UPDATE contracts SET notes = regexp_replace(notes, '\s*\(lettera di offerta Fanfani\)', '', 'gi') WHERE notes ILIKE '%fanfani%';
UPDATE contracts SET notes = regexp_replace(notes, '(di |dell''|dell’)?era Fanfani', 'della gestione precedente', 'gi') WHERE notes ILIKE '%fanfani%';
UPDATE contracts SET notes = regexp_replace(notes, 'lettera (di offerta )?Fanfani', 'lettera di offerta precedente', 'gi') WHERE notes ILIKE '%fanfani%';
UPDATE contracts SET notes = regexp_replace(notes, 'Fanfani', 'gestione precedente', 'gi') WHERE notes ILIKE '%fanfani%';
UPDATE org_ext SET notes = regexp_replace(notes, 'Fanfani', 'gestione precedente', 'gi') WHERE notes ILIKE '%fanfani%';
UPDATE accounts SET note = regexp_replace(note, 'Fanfani', 'gestione precedente', 'gi') WHERE note ILIKE '%fanfani%';
UPDATE accounts SET fornitore_attuale = 'Altro' WHERE fornitore_attuale ILIKE '%fanfani%';
UPDATE activities SET testo = regexp_replace(testo, 'Fanfani', 'gestione precedente', 'gi') WHERE testo ILIKE '%fanfani%';
UPDATE activities SET oggetto = regexp_replace(oggetto, 'Fanfani', 'gestione precedente', 'gi') WHERE oggetto ILIKE '%fanfani%';
