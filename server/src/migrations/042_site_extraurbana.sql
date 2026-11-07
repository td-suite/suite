-- Retail Assistant · Intorno (richiesta del CEO del 07/11/2026, docs/RETAIL_INTORNO.md): una sede extraurbana usa un raggio più ampio
-- (10 km predefiniti invece di 3 km) per la rilevazione di cosa c'è intorno. Si spunta in Amministrazione > Sedi.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS extraurbana BOOLEAN NOT NULL DEFAULT FALSE;
