-- v0.91.0 (CEO, 20/11/2026): benefit e dotazioni anche nella lettera di impegno, per poterli copiare da un'altra lettera insieme a RAL
-- e MBO e portarli nel contratto alla conversione. Stesso formato di employments.benefits (jsonb di stringhe). Idempotente.
ALTER TABLE commitment_letters ADD COLUMN IF NOT EXISTS benefits JSONB NOT NULL DEFAULT '[]'::jsonb;
