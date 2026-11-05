-- Correzioni del debug pre-produzione (05/11/2026, autorizzazione del CEO).

-- A2 · Un accesso nato esterno resta esterno: cambiare la Legal entity della persona (o darle un'email aziendale) non lo rende interno.
-- Il valore iniziale degli utenti già presenti lo calcola il seed all'avvio (migrate.js, una volta sola), con i domini aziendali
-- della configurazione (AUTO_INTERNAL_DOMAINS), che qui non sono leggibili.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_external BOOLEAN NOT NULL DEFAULT FALSE;

-- A3 · Profilo Default dei dipendenti: Cartella condivisa in sola consultazione (VIEWER, non più Gestione) e Ticket in solo inserimento
-- (UTENTE: apre ticket e vede i propri, non più Responsabile di unità). Si corregge l'elenco del profilo Default qualunque sia
-- stato modificato nel frattempo, toccando soltanto quelle due voci.
UPDATE access_profiles ap SET items = (
    SELECT coalesce(jsonb_agg(CASE
             WHEN it->>'module_key' = 'cartella' AND it->>'profile' = 'ADMIN' THEN jsonb_build_object('module_key', 'cartella', 'profile', 'VIEWER')
             WHEN it->>'module_key' = 'ticket' AND it->>'profile' = 'RESPONSABILE' THEN jsonb_build_object('module_key', 'ticket', 'profile', 'UTENTE')
             ELSE it END ORDER BY ord), '[]'::jsonb)
      FROM jsonb_array_elements(ap.items) WITH ORDINALITY AS x(it, ord)),
  updated_at = now()
 WHERE ap.is_default AND ap.name = 'Default';

-- A3 · Riallineamento dei grant già assegnati dal Default: solo quelli nati dal profilo Default (profile_id del Default, source
-- PROFILE) con esattamente il vecchio valore. I grant assegnati a mano (profile_id NULL) o da altri profili non si toccano.
-- Ogni grant cambiato resta nell'audit (GRANT_REALIGNED_DEFAULT) con il valore precedente e quello nuovo.
WITH def AS (SELECT id FROM access_profiles WHERE is_default AND name = 'Default' LIMIT 1),
cambiati AS (
  UPDATE grants g SET profile = CASE g.module_key WHEN 'cartella' THEN 'VIEWER' ELSE 'UTENTE' END, updated_at = now()
    FROM def
   WHERE g.profile_id = def.id AND g.source = 'PROFILE' AND NOT g.proposed
     AND ((g.module_key = 'cartella' AND g.profile = 'ADMIN') OR (g.module_key = 'ticket' AND g.profile = 'RESPONSABILE'))
  RETURNING g.id, g.user_id, g.module_key, g.profile
)
INSERT INTO audit_log (user_id, action, module_key, entity, entity_id, label, data)
SELECT NULL, 'GRANT_REALIGNED_DEFAULT', c.module_key, 'user', c.user_id::text,
       format('%s → %s:%s (profilo Default corretto, debug pre-produzione A3)', u.email, c.module_key, c.profile),
       jsonb_build_object('grant_id', c.id, 'module_key', c.module_key, 'from', CASE c.module_key WHEN 'cartella' THEN 'ADMIN' ELSE 'RESPONSABILE' END, 'to', c.profile, 'migration', '040_debug_preprod')
  FROM cambiati c JOIN users u ON u.id = c.user_id;

-- L10 · Indici sulle chiavi esterne usate nei filtri frequenti (rubrica, perimetri, bacheca, notizie, organigramma)
CREATE INDEX IF NOT EXISTS people_site_idx ON people (site_id);
CREATE INDEX IF NOT EXISTS people_organization_idx ON people (organization_id);
CREATE INDEX IF NOT EXISTS people_unit_idx ON people (unit_id);
CREATE INDEX IF NOT EXISTS people_role_idx ON people (role_id);
CREATE INDEX IF NOT EXISTS people_manager_idx ON people (manager_person_id);
CREATE INDEX IF NOT EXISTS users_person_idx ON users (person_id);
CREATE INDEX IF NOT EXISTS users_site_idx ON users (site_id);
CREATE INDEX IF NOT EXISTS users_organization_idx ON users (organization_id);
CREATE INDEX IF NOT EXISTS sites_organization_idx ON sites (organization_id);
CREATE INDEX IF NOT EXISTS posts_author_idx ON posts (author_id);
CREATE INDEX IF NOT EXISTS posts_site_idx ON posts (site_id);
CREATE INDEX IF NOT EXISTS post_comments_author_idx ON post_comments (author_id);
CREATE INDEX IF NOT EXISTS post_reactions_user_idx ON post_reactions (user_id);
CREATE INDEX IF NOT EXISTS news_author_idx ON news (author_id);
CREATE INDEX IF NOT EXISTS news_acks_user_idx ON news_acks (user_id);
CREATE INDEX IF NOT EXISTS news_comments_author_idx ON news_comments (author_id);
CREATE INDEX IF NOT EXISTS events_site_idx ON events (site_id);
CREATE INDEX IF NOT EXISTS org_positions_person_idx ON org_positions (person_id);
CREATE INDEX IF NOT EXISTS org_units_parent_idx ON org_units (parent_id);
CREATE INDEX IF NOT EXISTS org_units_site_idx ON org_units (site_id);
CREATE INDEX IF NOT EXISTS org_units_head_idx ON org_units (head_person_id);
CREATE INDEX IF NOT EXISTS grants_module_idx ON grants (module_key);
CREATE INDEX IF NOT EXISTS read_log_user_idx ON read_log (user_id);
