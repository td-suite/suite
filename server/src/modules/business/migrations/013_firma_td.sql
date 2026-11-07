-- Business Hub · firma del firmatario dei contratti di Toscana Diagnostica (richiesta del CEO del 07/11/2026: "fammi caricare la firma
-- del firmatario del contratto (PNG, JPG) in modo tale che venga perfettamente apposta nel pdf"). Una sola immagine (riga id = 1):
-- archivio a due vie come i documenti (Azure Blob se configurato, altrimenti bytea). Nome e qualifica del firmatario sono impostazioni
-- (app_settings firma_nome, firma_qualifica; vuote = legale rappresentante). Docs: docs/BUSINESS_HUB.md, "Firma di TD".
CREATE TABLE IF NOT EXISTS firma_td (
  id          INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  filename    TEXT NOT NULL,
  mime        TEXT NOT NULL CHECK (mime IN ('image/png', 'image/jpeg')),
  size        INT NOT NULL,
  sha256      TEXT NOT NULL,
  larghezza   INT NOT NULL,
  altezza     INT NOT NULL,
  data        BYTEA,
  blob_path   TEXT,
  updated_by  INT REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
