-- Interno telefonico (centralino 055 776511) sulla scheda persona; numeri utili di reparto in settings
ALTER TABLE people ADD COLUMN IF NOT EXISTS phone_ext TEXT;
