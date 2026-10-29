-- Correzione del 29/10/2026 su indicazione del CEO: si salvano i dati completi del paziente (cognome e nome, sesso, luogo e data di
-- nascita, indirizzo se presente) e solo il contenuto del riquadro dei risultati del PDF esterno.
-- - luogo_nascita e indirizzo: nuove colonne di ricerca della scheda (accanto a cognome_nome, data_nascita, sesso).
-- - accettazione, data_acc, referto_codice, referto_data (codici del laboratorio esterno) restano SOLO come riferimento interno
--   di tracciabilità ISO 9001 nel registro/archivio: non compaiono mai nel DOCX né nel PDF TD.
-- - testo_sorgente contiene da ora soltanto la riga anagrafica e il testo del riquadro risultati (non l'intero testo del PDF);
--   le schede già presenti conservano il testo salvato in precedenza finché non vengono ricaricate.
ALTER TABLE schede ADD COLUMN IF NOT EXISTS luogo_nascita TEXT;
ALTER TABLE schede ADD COLUMN IF NOT EXISTS indirizzo TEXT;
CREATE INDEX IF NOT EXISTS schede_luogo_idx ON schede (lower(luogo_nascita));
COMMENT ON COLUMN schede.accettazione IS 'Codice di accettazione del laboratorio esterno: solo riferimento interno di tracciabilità (registro), mai nel DOCX';
COMMENT ON COLUMN schede.data_acc IS 'Data di accettazione del laboratorio esterno: solo riferimento interno di tracciabilità (registro), mai nel DOCX';
COMMENT ON COLUMN schede.referto_codice IS 'Codice del referto del laboratorio esterno: solo riferimento interno di tracciabilità (registro), mai nel DOCX';
COMMENT ON COLUMN schede.testo_sorgente IS 'Riga anagrafica + testo del riquadro risultati del PDF esterno (per il controllo di coerenza); non l''intero PDF';
