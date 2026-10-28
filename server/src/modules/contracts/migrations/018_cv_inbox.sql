-- CV Box alimentato dalla casella recruitment@: identificativo dell'allegato Graph per non importare due volte lo stesso CV
ALTER TABLE cv_box ADD COLUMN IF NOT EXISTS graph_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS cv_box_graph_id_uq ON cv_box (graph_id) WHERE graph_id IS NOT NULL;
INSERT INTO app_settings (key, value) VALUES ('cv_inbox', 'recruitment@toscanadiagnostica.it'), ('cv_inbox_enabled', 'true') ON CONFLICT (key) DO NOTHING;
