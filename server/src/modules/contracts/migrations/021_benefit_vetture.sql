-- v0.72.0 · Benefit "vettura aziendale" e "fuel card" della persona (richiesta del CEO del 13/11/2026). Le assegnazioni le inserisce P&C
-- (profili ADMIN e HR del modulo) o il titolare nella scheda della persona, sezione "Benefit: vettura e fuel card"; il modulo Rimborso
-- Spese le legge (lib/benefitAuto.js) per escludere il rimborso chilometrico e registrare le spese di carburante pagate con la carta.
-- Coerenza con employments.benefits (jsonb di stringhe): l'assegnazione aggiunge la voce "Vettura aziendale" / "Fuel card".
-- Nessun dato reale nel seme: targhe e numeri di carta li inserisce il CEO. Il PIN della carta non si salva MAI (nessuna colonna).
-- Idempotente.
CREATE TABLE IF NOT EXISTS benefit_vetture (
  id             SERIAL PRIMARY KEY,
  person_id      INT NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  marca          TEXT NOT NULL,
  modello        TEXT NOT NULL,
  targa          TEXT NOT NULL,
  alimentazione  TEXT,
  dal            DATE NOT NULL,
  al             DATE,
  uso_promiscuo  BOOLEAN NOT NULL DEFAULT FALSE,
  note           TEXT,
  created_by     INT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by     INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (al IS NULL OR al >= dal)
);
CREATE INDEX IF NOT EXISTS benefit_vetture_persona ON benefit_vetture (person_id);

CREATE TABLE IF NOT EXISTS benefit_fuel_card (
  id             SERIAL PRIMARY KEY,
  person_id      INT NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  circuito       TEXT NOT NULL,               -- es. DKV
  numero         TEXT NOT NULL,               -- per intero; mostrato mascherato salvo a P&C, titolare e assegnatario
  dal            DATE NOT NULL,
  al             DATE,
  vettura_id     INT REFERENCES benefit_vetture(id) ON DELETE SET NULL,
  note           TEXT,
  created_by     INT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by     INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (al IS NULL OR al >= dal)
);
CREATE INDEX IF NOT EXISTS benefit_fuel_card_persona ON benefit_fuel_card (person_id);
CREATE UNIQUE INDEX IF NOT EXISTS benefit_fuel_card_numero ON benefit_fuel_card (circuito, regexp_replace(numero, '\s', '', 'g'));
