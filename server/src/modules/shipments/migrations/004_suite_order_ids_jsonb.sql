-- Suite TD: la copia del travaso (lib/travaso.js) serializza gli array JavaScript come JSON ("[1,2]"), che PostgreSQL non accetta
-- come literal di INT[]. La colonna diventa JSONB: stesso contenuto (elenco di id richiesta), nessuna differenza per il front-end.
ALTER TABLE inbox_messages ALTER COLUMN order_ids DROP DEFAULT;
ALTER TABLE inbox_messages ALTER COLUMN order_ids TYPE JSONB USING to_jsonb(order_ids);
ALTER TABLE inbox_messages ALTER COLUMN order_ids SET DEFAULT '[]'::jsonb;
