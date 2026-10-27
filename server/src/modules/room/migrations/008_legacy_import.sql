-- Importazione dei contenuti dall'app originale (Amministrazione > Travaso moduli > "Importa i contenuti dall'app originale").
-- Il modulo è partito vuoto sull'anagrafica unica: le sedi e le persone dell'app si abbinano a public.sites / public.people e i
-- contenuti (impostazioni Room, planimetrie, cronologia, eventi, turni, presenze, rendiconti, bacheca...) si copiano con gli id tradotti.
-- Questa tabella ricorda quale riga della Suite è nata da quale riga dell'app: un'importazione ripetuta non duplica nulla (inserisce
-- solo ciò che manca) e i riferimenti interni (turno del posizione, rendiconto della presenza...) si traducono con la stessa mappa.
CREATE TABLE IF NOT EXISTS legacy_import_map (
  tabella     TEXT NOT NULL,          -- tabella dell'app originale (strutture, professionisti, turni, ...)
  legacy_id   TEXT NOT NULL,          -- chiave della riga nell'app originale
  suite_id    TEXT NOT NULL,          -- chiave della riga nel modulo (o id dell'anagrafica unica per strutture / professionisti)
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tabella, legacy_id)
);
