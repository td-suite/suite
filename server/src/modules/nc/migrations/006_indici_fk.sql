-- Indici sulle chiavi esterne usate nei filtri e nei perimetri (debug pre-produzione del 05/11/2026, L10)
CREATE INDEX IF NOT EXISTS nc_site_idx ON nc (site_id);
CREATE INDEX IF NOT EXISTS nc_org_idx ON nc (org_id);
CREATE INDEX IF NOT EXISTS nc_tipo_idx ON nc (tipo_id);
CREATE INDEX IF NOT EXISTS accettazioni_site_idx ON accettazioni (site_id);
CREATE INDEX IF NOT EXISTS accettazioni_org_idx ON accettazioni (org_id);
CREATE INDEX IF NOT EXISTS nc_azioni_nc_idx ON nc_azioni (nc_id);
CREATE INDEX IF NOT EXISTS nc_allegati_messaggio_idx ON nc_allegati (messaggio_id);
CREATE INDEX IF NOT EXISTS email_log_nc_idx ON email_log (nc_id);
