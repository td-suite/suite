-- Importazione dei contenuti dall'app originale (Amministrazione > Travaso moduli > "Importa i contenuti dall'app originale").
-- Il modulo è partito vuoto sull'anagrafica unica: le target dell'app si abbinano alle Legal entity public.organizations (kind TARGET,
-- o SOCIETA se l'acquisizione è già conclusa) e le persone del team a public.people; i contenuti (parametri del piano in org_ext,
-- ruolo nel piano in person_ext, attività con owner e support, snapshot, registro) si copiano con gli id tradotti.
-- Questa tabella ricorda quale riga della Suite è nata da quale riga dell'app: un'importazione ripetuta non duplica nulla (inserisce
-- solo ciò che manca) e i riferimenti interni (target delle attività e degli snapshot) si traducono con la stessa mappa.
CREATE TABLE IF NOT EXISTS legacy_import_map (
  tabella     TEXT NOT NULL,          -- tabella dell'app originale (targets, team, activities, snapshots, audit_log)
  legacy_id   TEXT NOT NULL,          -- chiave della riga nell'app originale (per le attività "target_id|id")
  suite_id    TEXT NOT NULL,          -- chiave della riga nel modulo (o id dell'anagrafica unica per targets / team)
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tabella, legacy_id)
);
