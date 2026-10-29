-- Importazione del catalogo articoli dall'app originale (orders.toscanadiagnostica.it/articoli), richiesta del CEO del 29/10/2026:
-- "In Ordini, precarica il catalogo articoli che avevamo". Amministrazione > Travaso moduli > "Importa i contenuti dall'app originale".
-- La mappa ricorda quale riga della Suite è nata da quale riga dell'app: ripetibile senza duplicati.
CREATE TABLE IF NOT EXISTS legacy_import_map (
  tabella     TEXT NOT NULL,
  legacy_id   TEXT NOT NULL,
  suite_id    TEXT NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tabella, legacy_id)
);
