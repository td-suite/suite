-- Anagrafica unica, regola delle organizzazioni (docs/ANAGRAFICA.md): il modulo conserva soltanto integration.org_ext
-- (org_id -> public.organizations ON DELETE CASCADE) con i campi operativi del piano. La tabella target_ext della
-- migrazione 002 viene rinominata in org_ext senza perdere i dati (se esiste); se il modulo è partito da zero la tabella
-- viene creata direttamente.
--
-- Le "sedi da integrare" sono TUTTE le Legal entity di tipo TARGET, anche se il piano non è ancora stato avviato
-- (LEFT JOIN su org_ext, colonna configured). Quando l'Amministrazione cambia il tipo da TARGET a SOCIETA (acquisizione
-- conclusa) la riga resta nel modulo con i suoi dati e si mostra come "integrata" (colonna integrated): il piano resta
-- consultabile, non si cancella nulla.

DO $$
BEGIN
  IF to_regclass('integration.target_ext') IS NOT NULL THEN
    ALTER TABLE integration.target_ext RENAME TO org_ext;
    ALTER TABLE integration.org_ext RENAME CONSTRAINT target_ext_pkey TO org_ext_pkey;
    ALTER TABLE integration.org_ext RENAME CONSTRAINT target_ext_status_check TO org_ext_status_check;
    ALTER TABLE integration.org_ext RENAME CONSTRAINT target_ext_org_id_fkey TO org_ext_org_id_fkey;
    ALTER TABLE integration.org_ext RENAME CONSTRAINT target_ext_updated_by_fkey TO org_ext_updated_by_fkey;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS org_ext (
  org_id     INT PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  position   INT NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'ATTIVO' CHECK (status IN ('ATTIVO','SOSPESO','CONCLUSO')),
  ref        TEXT NOT NULL DEFAULT '',
  fatt       TEXT NOT NULL DEFAULT '',
  pfn        TEXT NOT NULL DEFAULT '',
  ev         TEXT NOT NULL DEFAULT '',
  linee      JSONB NOT NULL DEFAULT '[]'::jsonb,
  loi        TEXT NOT NULL DEFAULT '',
  prelim     TEXT NOT NULL DEFAULT '',
  closing    TEXT NOT NULL DEFAULT '',
  hor        INT NOT NULL DEFAULT 24,
  note       TEXT NOT NULL DEFAULT '',
  lm         BIGINT NOT NULL DEFAULT 0,
  version    INT NOT NULL DEFAULT 1,
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vista delle target per il motore del piano: una riga per ogni Legal entity TARGET (anche senza org_ext) più le
-- organizzazioni che hanno un piano e nel frattempo hanno cambiato tipo (integrate). I campi operativi mancanti prendono
-- i valori di default così il client riceve sempre una riga completa; configured dice se il piano è stato avviato.
DROP VIEW IF EXISTS targets_v;
CREATE VIEW targets_v AS
  SELECT o.id, o.kind, o.code, o.name AS nome, o.name AS rs,
         trim(both ' ,' from concat_ws(', ', nullif(o.address, ''), nullif(concat_ws(' ', nullif(o.zip, ''), nullif(o.city, '')), ''), nullif(o.province, ''))) AS ind,
         coalesce(o.vat_number, '') AS piva, coalesce(o.phone, '') AS tel, coalesce(o.email, '') AS mail, coalesce(o.website, '') AS web, coalesce(o.pec, '') AS pec,
         o.active,
         (x.org_id IS NOT NULL) AS configured,
         (x.org_id IS NOT NULL AND o.kind <> 'TARGET') AS integrated,
         coalesce(x.position, 1000000) AS position,
         coalesce(x.status, 'ATTIVO') AS status,
         coalesce(x.ref, '') AS ref, coalesce(x.fatt, '') AS fatt, coalesce(x.pfn, '') AS pfn, coalesce(x.ev, '') AS ev,
         coalesce(x.linee, '[]'::jsonb) AS linee,
         coalesce(x.loi, '') AS loi, coalesce(x.prelim, '') AS prelim, coalesce(x.closing, '') AS closing,
         coalesce(x.hor, 24) AS hor, coalesce(x.note, '') AS note,
         coalesce(x.lm, 0) AS lm, coalesce(x.version, 0) AS version,
         x.updated_by, x.updated_at, x.created_at
    FROM public.organizations o LEFT JOIN org_ext x ON x.org_id = o.id
   WHERE o.kind = 'TARGET' OR x.org_id IS NOT NULL;
