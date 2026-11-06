-- Business Hub (richiesta del CEO, 06/11/2026): il widget "Contratti B2C/B2B" diventa "Business Hub", la centrale di registrazione del
-- business (CRM a fasi, contatti, criticità, feed da NC/Ordini/Ticket, caselle service@/network@/mdl@). La chiave del modulo resta
-- `business` (route /business, API /api/business, schema business, grant e profili invariati). Il seed (seed/modules.js) riallinea
-- il catalogo a ogni avvio; questa migrazione aggiorna subito la riga esistente.
UPDATE modules SET name = 'Business Hub', tagline = 'Pipeline, clienti, contratti, contatti e criticità: la centrale del business', icon = 'business-hub', updated_at = now()
 WHERE key = 'business';
