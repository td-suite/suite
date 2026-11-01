-- SGI Management nativo (richiesta del CEO, 01/11/2026: "Vorrei fare poi la stessa cosa con SGI! Perfettamente!"): il widget non apre
-- più il sito esterno sgi.toscanadiagnostica.it ma il modulo /sgi della Suite, copia conforme del sito pubblico (specchio di sola
-- lettura, docs/SGI_PORTALE.md), come il Portale Service (037). Si aggiorna solo la riga del catalogo: kind, URL esterno, route e
-- apertura a tutti gli autenticati (il SGI è pubblico per decisione AD 01/10/2026); profili, grant, nome e ordinamento restano.
UPDATE modules SET kind = 'NATIVE', legacy_url = NULL, route = '/sgi', open_to_all = TRUE, updated_at = now() WHERE key = 'sgi';
