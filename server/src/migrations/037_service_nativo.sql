-- Portale Service nativo (richiesta del CEO, 01/11/2026): il widget non apre più il sito esterno ma il modulo /service della Suite,
-- copia conforme del sito pubblico (specchio di sola lettura, docs/SERVICE_PORTALE.md). Si aggiorna solo la riga del catalogo:
-- kind, URL esterno, route e apertura a tutti gli autenticati; profili, grant, nome e ordinamento restano quelli del seme.
UPDATE modules SET kind = 'NATIVE', legacy_url = NULL, route = '/service', open_to_all = TRUE, updated_at = now() WHERE key = 'service';

-- "Ordine del materiale" del portale apre il widget Ordini: il profilo di sistema Cliente service riceve Ordini e Magazzino con il
-- profilo CLIENTE (ambito: le sedi della Legal entity, risolto da resolveExternalScopes). Solo se manca: gli item restano modificabili
-- dal titolare. Gli utenti già creati lo ricevono con "Riallinea perimetri" / "Applica profilo".
UPDATE access_profiles SET items = items || '[{"module_key":"orders","profile":"CLIENTE"}]'::jsonb, updated_at = now()
 WHERE system_key = 'CLIENTE_SERVICE' AND NOT items @> '[{"module_key":"orders"}]'::jsonb;
