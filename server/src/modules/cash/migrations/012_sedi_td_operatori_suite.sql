-- Anagrafica unica (docs/ANAGRAFICA.md), terza parte. Due decisioni di Francesco Epifani (26/10/2026):
-- 1. Cash tratta solo le sedi di Toscana Diagnostica: le strutture dei clienti service (public.sites.kind = 'SERVICE') non
--    compaiono mai (elenco, selettori, statistiche). La vista sites_v passa a LEFT JOIN su site_ext così che anche le sedi TD
--    non ancora configurate in Cash siano visibili nella pagina Sedi, con `configured` a dire se esistono le impostazioni.
-- 2. Nessuna anagrafica degli operatori in Cash: gli operatori sono gli utenti della Suite con un grant sul modulo cash
--    (public.grants / grant_scopes). La tabella users dello schema resta solo come riga tecnica per le chiavi esterne
--    (created_by, operator_id, ...), agganciata all'utente Suite con suite_user_id; nomi, email, profilo e sedi si leggono
--    dalla Suite tramite le viste users_v (per riga tecnica) e operators_v (per utente Suite). L'unico campo operativo di Cash
--    per persona, il fondo cassa personale dell'operatore, passa in user_ext (user_id -> public.users).

-- ---------- 1. Sedi ----------
DROP VIEW IF EXISTS sites_v;
CREATE VIEW sites_v AS
  SELECT s.id, s.code, s.name, s.address, s.city, s.province, s.active, s.kind, s.organization_id,
         (e.site_id IS NOT NULL) AS configured,
         e.company_id, e.cash_float, e.operating_days, e.pos_terminals, e.start_date, e.ownership, e.hours, e.hours_note,
         e.expected_registers, e.site_email, e.host_name, e.host_vat, e.host_email,
         e.royalty_fixed_monthly, e.royalty_pct, e.royalty_base, e.royalty_vat_rate, e.royalty_notes,
         e.created_at, e.updated_at
    FROM public.sites s LEFT JOIN site_ext e ON e.site_id = s.id
   WHERE s.kind IS DISTINCT FROM 'SERVICE';

-- ---------- 2. Operatori ----------
-- Riga tecnica agganciata all'utente Suite (riempita per email per le righe esistenti; ensureCashUser la imposta alla creazione)
ALTER TABLE users ADD COLUMN IF NOT EXISTS suite_user_id INT REFERENCES public.users(id) ON DELETE SET NULL;
UPDATE users u SET suite_user_id = pu.id FROM public.users pu WHERE u.suite_user_id IS NULL AND lower(pu.email) = lower(u.email);
CREATE INDEX IF NOT EXISTS users_suite_user_idx ON users (suite_user_id);

-- Campi operativi di Cash per persona (solo questi): fondo cassa personale dell'operatore
CREATE TABLE IF NOT EXISTS user_ext (
  user_id    INT PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  cash_float NUMERIC(12,2) CHECK (cash_float IS NULL OR cash_float >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO user_ext (user_id, cash_float)
  SELECT u.suite_user_id, u.cash_float FROM users u WHERE u.suite_user_id IS NOT NULL AND u.cash_float IS NOT NULL
  ON CONFLICT (user_id) DO UPDATE SET cash_float = EXCLUDED.cash_float, updated_at = now();
ALTER TABLE users DROP COLUMN IF EXISTS cash_float;

-- Utenti della Suite con grant confermato sul modulo cash: l'elenco operatori e il perimetro di ciascuno.
-- id = public.users.id; cash_user_id = riga tecnica (se l'utente è già entrato in Cash); company_id = azienda Cash
-- (riga tecnica, altrimenti la sede del perimetro, l'organizzazione dell'utente o lo scope ORG).
CREATE VIEW operators_v AS
  SELECT pu.id, cu.id AS cash_user_id, pu.email, pu.full_name, pu.first_name, pu.last_name, pu.person_id, pu.level AS suite_level,
         g.profile AS role, pu.status, (pu.status = 'ACTIVE') AS active, pu.last_login_at,
         coalesce(cu.company_id,
                  (SELECT e.company_id FROM public.grant_scopes gs JOIN site_ext e ON e.site_id = gs.scope_id
                    WHERE gs.grant_id = g.id AND gs.scope_type = 'SITE' ORDER BY gs.scope_id LIMIT 1),
                  (SELECT c.id FROM companies_v c WHERE c.id = pu.organization_id),
                  (SELECT c.id FROM public.grant_scopes gs JOIN companies_v c ON c.id = gs.scope_id
                    WHERE gs.grant_id = g.id AND gs.scope_type = 'ORG' ORDER BY gs.scope_id LIMIT 1)) AS company_id,
         (SELECT coalesce(array_agg(gs.scope_id ORDER BY gs.scope_id), '{}')
            FROM public.grant_scopes gs WHERE gs.grant_id = g.id AND gs.scope_type = 'SITE') AS site_ids,
         x.cash_float
    FROM public.users pu
    JOIN public.grants g ON g.user_id = pu.id AND g.module_key = 'cash' AND NOT g.proposed
    LEFT JOIN users cu ON cu.suite_user_id = pu.id
    LEFT JOIN user_ext x ON x.user_id = pu.id;

-- Riga tecnica con i dati della Suite: la usano i rendiconti e gli altri documenti per nome, email e profilo di chi ha operato
-- (operator_id, created_by, verified_by, ...). Se l'utente Suite non c'è più restano i valori della riga tecnica.
CREATE VIEW users_v AS
  SELECT cu.id, cu.suite_user_id, coalesce(pu.email, cu.email) AS email, coalesce(pu.full_name, cu.full_name) AS full_name,
         pu.first_name, pu.last_name, pu.person_id, coalesce(g.profile, cu.role) AS role, cu.company_id,
         coalesce(pu.status = 'ACTIVE', cu.active) AS active, pu.last_login_at, x.cash_float
    FROM users cu
    LEFT JOIN public.users pu ON pu.id = cu.suite_user_id
    LEFT JOIN public.grants g ON g.user_id = pu.id AND g.module_key = 'cash' AND NOT g.proposed
    LEFT JOIN user_ext x ON x.user_id = pu.id;
