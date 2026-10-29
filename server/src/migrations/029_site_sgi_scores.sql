-- Allineamento al SGI delle sedi (richiesta del CEO, 29/10/2026): esito numerico della sintesi del modulo Audit SGI per ogni sede.
-- Scritta dal modulo audit (schema audit, sintesi di sede con Claude), letta da Retail Assistant nella scheda della sede
-- (GET /api/retail/sites/:id/structure → sgi). Una riga per sede; sparisce con la sede.
CREATE TABLE IF NOT EXISTS site_sgi_scores (
  site_id        INT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  score          NUMERIC(5,1),                 -- livello di allineamento 0-100
  level          TEXT,                         -- A Allineato, B Sostanzialmente allineato, C Parzialmente allineato, D Critico
  summary        TEXT,                         -- giudizio di sintesi (troncato a 400 caratteri)
  synthesis_id   INT,                          -- audit.syntheses.id (nessuna FK tra schemi: il modulo può essere azzerato)
  last_audit_at  TIMESTAMPTZ,                  -- data dell'ultimo audit considerato
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
