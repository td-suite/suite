-- Ordini v0.99.1 (CEO, 25/11/2026): la produzione si conta sul TESTO DELLE ETICHETTE, transcodificato sugli articoli di magazzino.
-- Il gestionale non passa il testo dell'etichetta del campione (samples.container vuoto): il nome dell'etichetta si ricava dalla
-- tabella delle provette di Lab Control (nome sull'etichetta = materiale | esami), la stessa che stampa le etichette. Le etichette
-- ricavate così hanno fonte 'PROVETTE'. Idempotente.
ALTER TABLE etichette_synclab DROP CONSTRAINT IF EXISTS etichette_synclab_fonte_check;
ALTER TABLE etichette_synclab ADD CONSTRAINT etichette_synclab_fonte_check CHECK (fonte IN ('CAMPIONI','SERVICENET','PROVETTE'));
