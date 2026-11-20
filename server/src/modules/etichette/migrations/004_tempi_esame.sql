-- Lab Control v0.91.1 (CEO, 20/11/2026): giorni di refertazione per codice esame. Regola del ritardo: un esame è in ritardo quando oggi è
-- oltre (data di accettazione + giorni di refertazione - 1). Il gestionale non espone questo dato (Data API Synclab: il catalogo esami
-- non ha i tempi): la tabella si carica dalle Impostazioni di Lab Control (file con codice e giorni, o a mano). Gli esami senza riga
-- usano l'impostazione giorni_refertazione (predefinito 3). Idempotente, non distruttiva.
CREATE TABLE IF NOT EXISTS lc_tempi_esame (
  codice      TEXT PRIMARY KEY,                 -- codice esame in MAIUSCOLO, senza spazi ai lati
  giorni      INT  NOT NULL CHECK (giorni BETWEEN 1 AND 365),
  descrizione TEXT,
  origine     TEXT NOT NULL DEFAULT 'MANUALE',  -- MANUALE | FILE
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by  INT
);
