-- Catalogo dei dispositivi sotto manutenzione (richiesta del CEO, 31/10/2026: "includere in Amministrazione il Catalogo dei Dispositivi
-- sotto manutenzione, ivi inclusi quelli di sicurezza"). Tabella core: la gestisce Amministrazione > Anagrafiche > Catalogo dispositivi
-- (Owner e Admin), la usa il modulo Facility e Manutenzioni (facility.assets.asset_type_code → code). Il seed iniziale (lib seed/assetTypes.js)
-- è un benchmark indicativo, da confermare con RSPP e Qualità: periodicità e riferimenti normativi vanno verificati prima dell'uso.
CREATE TABLE IF NOT EXISTS asset_types (
  id                           SERIAL PRIMARY KEY,
  code                         TEXT NOT NULL UNIQUE,              -- es. ESTINTORE_POLVERE
  name                         TEXT NOT NULL,
  category                     TEXT NOT NULL CHECK (category IN ('SICUREZZA_ANTINCENDIO','SICUREZZA_LUOGHI','IMPIANTI','CLIMA_ENERGIA','ELETTROMEDICALE',
                                                                 'DIAGNOSTICA_IMMAGINI','LABORATORIO','IT','ARREDI','EMERGENZA','IGIENE_AMBIENTE')),
  description                  TEXT,
  surveillance_months          INT CHECK (surveillance_months IS NULL OR surveillance_months BETWEEN 1 AND 120),     -- sorveglianza interna a cura della sede (es. mensile per gli estintori)
  check_interval_months        INT CHECK (check_interval_months IS NULL OR check_interval_months BETWEEN 1 AND 240), -- controllo periodico (manutentore o verificatore)
  check_kind                   TEXT NOT NULL DEFAULT 'CONTROLLO' CHECK (check_kind IN ('CONTROLLO','VERIFICA_NORMATIVA')),
  maintenance_interval_months  INT CHECK (maintenance_interval_months IS NULL OR maintenance_interval_months BETWEEN 1 AND 240), -- manutenzione / revisione
  legal_reference              TEXT,                              -- riferimento normativo in testo (indicativo)
  requires_certified_vendor    BOOLEAN NOT NULL DEFAULT FALSE,    -- serve un manutentore abilitato / ente verificatore
  applies_to_kinds             TEXT[] NOT NULL DEFAULT '{}',      -- tipologie di sede (vuoto = tutte): PUNTO_PRELIEVI, CENTRO_DIAGNOSTICO, ...
  benchmark_note               TEXT,                              -- nota del benchmark ("da confermare con RSPP e Qualità")
  active                       BOOLEAN NOT NULL DEFAULT TRUE,
  sort                         INT NOT NULL DEFAULT 100,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS asset_types_category_idx ON asset_types (category, sort);
