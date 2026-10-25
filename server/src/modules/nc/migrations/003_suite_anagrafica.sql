-- Anagrafica unica della Suite (docs/ANAGRAFICA.md): le sedi invianti esistono una volta sola in public.sites e si caricano
-- da Amministrazione. La tabella sedi dell'app e le assegnazioni utente/sede (users_sedi) spariscono; resta site_ext con i soli
-- campi operativi del modulo NC (codice cliente StudioLAB, canale di invio, email/PEC di notifica, SLA, attiva per NC).
-- Il perimetro degli utenti di sede viene dagli scope SITE del grant Suite (req.user.site_ids).

DROP TABLE IF EXISTS users_sedi CASCADE;
DROP TABLE IF EXISTS sedi CASCADE;

CREATE TABLE site_ext (
  site_id        INT PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  codice_lis     TEXT,                                   -- CodiceCliente StudioLAB della sede inviante, se diverso da public.sites.studiolab_code
  canale         TEXT NOT NULL DEFAULT 'EMAIL' CHECK (canale IN ('EMAIL','PEC','PORTALE','NESSUNO')),   -- come la sede riceve le NC
  email_nc       TEXT,                                   -- casella che riceve le non conformità (se vuota: email della sede in Amministrazione)
  pec            TEXT,                                   -- PEC, usata quando il canale è PEC
  email_cc       TEXT,                                   -- destinatari in copia (separati da virgola)
  sla_ore        INT CHECK (sla_ore IS NULL OR sla_ore BETWEEN 1 AND 240),   -- ore lavorative per la risposta; NULL = valore globale
  attiva         BOOLEAN NOT NULL DEFAULT TRUE,          -- la sede riceve NC (indipendente dallo stato attivo in Amministrazione)
  note           TEXT,
  lis_json       JSONB,                                  -- ultimo oggetto Cliente ricevuto dal LIS
  lis_synced_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX site_ext_codice_lis_uq ON site_ext (lower(codice_lis)) WHERE codice_lis IS NOT NULL;

-- Chiavi esterne verso l'anagrafica unica (il DROP CASCADE le ha tolte)
ALTER TABLE accettazioni ADD CONSTRAINT accettazioni_sede_id_fkey FOREIGN KEY (sede_id) REFERENCES public.sites(id);
ALTER TABLE nc           ADD CONSTRAINT nc_sede_id_fkey           FOREIGN KEY (sede_id) REFERENCES public.sites(id);

-- Vista con le colonne che il codice dell'app si aspetta dalla vecchia tabella sedi: tutte le sedi dell'anagrafica unica,
-- con le impostazioni NC se presenti (configurata = ha una riga in site_ext). Le FK restano su public.sites.
CREATE VIEW sites_v AS
  SELECT s.id,
         coalesce(e.codice_lis, s.studiolab_code, s.code) AS codice,
         s.code AS suite_code, s.studiolab_code,
         s.name AS nome, s.kind AS tipo,
         s.phone AS telefono, s.manager_name AS referente, s.address AS indirizzo,
         nullif(concat_ws(' ', s.zip, s.city, CASE WHEN s.province IS NOT NULL THEN '(' || s.province || ')' END), '') AS citta,
         s.active AS attiva_suite,
         (s.active AND coalesce(e.attiva, TRUE)) AS attiva,
         (e.site_id IS NOT NULL) AS configurata,
         coalesce(e.canale, 'EMAIL') AS canale,
         e.codice_lis, e.email_nc, e.pec, e.email_cc, s.email AS email_suite,
         CASE WHEN coalesce(e.canale, 'EMAIL') IN ('NESSUNO', 'PORTALE') THEN NULL
              WHEN coalesce(e.canale, 'EMAIL') = 'PEC' THEN coalesce(e.pec, e.email_nc, s.email)
              ELSE coalesce(e.email_nc, s.email) END AS email_effettiva,
         e.sla_ore, e.note, e.lis_json, e.lis_synced_at, e.updated_at AS ext_updated_at
    FROM public.sites s LEFT JOIN site_ext e ON e.site_id = s.id;
