-- Indici sulle chiavi esterne usate nei filtri e nelle notifiche (debug pre-produzione del 05/11/2026, L10)
CREATE INDEX IF NOT EXISTS commenti_autore ON commenti (autore_user_id);
CREATE INDEX IF NOT EXISTS allegati_commento ON allegati (commento_id);
CREATE INDEX IF NOT EXISTS osservatori_user ON osservatori (user_id);
CREATE INDEX IF NOT EXISTS eventi_user ON eventi (user_id);
CREATE INDEX IF NOT EXISTS tickets_categoria ON tickets (categoria_id);
CREATE INDEX IF NOT EXISTS tickets_escalation_unit ON tickets (escalation_unit_id);
CREATE INDEX IF NOT EXISTS tickets_per_conto_org ON tickets (per_conto_org_id);
CREATE INDEX IF NOT EXISTS tickets_per_conto_site ON tickets (per_conto_site_id);
CREATE INDEX IF NOT EXISTS tickets_richiedente_person ON tickets (richiedente_person_id);
