-- Finance Management (richiesta del CEO, 08/11/2026): il widget "Payments" si chiama "Finance Management" e ospiterà il conto
-- economico di sede e il margine per cliente Service. La chiave del modulo resta `finance` (route /finance, API /api/finance, schema
-- finance, grant e profili invariati). Il seed (seed/modules.js) riallinea il catalogo a ogni avvio; questa migrazione aggiorna subito
-- la riga esistente. Idempotente, nessun dato toccato.
UPDATE modules SET name = 'Finance Management', updated_at = now() WHERE key = 'finance' AND name <> 'Finance Management';
