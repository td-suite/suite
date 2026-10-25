-- Orari di apertura strutturati per giorno (fino a due fasce), con testo riassuntivo in opening_hours
ALTER TABLE sites ADD COLUMN IF NOT EXISTS opening_hours_json JSONB;
