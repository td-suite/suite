-- Business Hub · linea Punti Prelievo: processo completo (richiesta del CEO del 06/11/2026). Anagrafica del punto prelievi nell'account
-- PP (sede TD collegata, flagship o corner derivato dalla sede, tipo previsto finché la sede non c'è, date di avvio), contratto al partner
-- da network@ con la form pubblica in variante PARTNER, ascolto della casella, contratto firmato nel fascicolo, avvio del punto prelievi
-- in passi registrati (credenziali Suite al partner, conferma interna, annuncio al laboratorio, primo ordine standard in Ordini, email di
-- approvvigionamento, fondo cassa e POS, rifiuti speciali) con "Riprova". Docs: docs/BUSINESS_HUB.md, sezione "Processo Punti Prelievo".

-- Account PP: un punto prelievi per account. Una Legal entity può avere più punti (un partner che ospita due corner, la società TD con
-- più flagship): l'unicità per Legal entity e linea resta per Service e Medicina del Lavoro, per i Punti Prelievo vale per sede o nome.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pp_site_id INT REFERENCES public.sites(id) ON DELETE SET NULL;   -- sede TD (kind PUNTO_PRELIEVI)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pp_nome TEXT;                                                     -- nome del punto finché la sede non c'è
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pp_tipo_previsto TEXT CHECK (pp_tipo_previsto IN ('FLAGSHIP','CORNER'));  -- da confermare con la sede
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS data_avvio_effettiva DATE;                                        -- data effettiva di avvio del punto
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pp_avvio_at TIMESTAMPTZ;                                          -- avvio iniziato (contratto firmato o "Avvia")
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS pp_avvio JSONB;                                                   -- stato dei passi dell'avvio
DO $$
DECLARE c TEXT;
BEGIN
  SELECT conname INTO c FROM pg_constraint WHERE conrelid = 'accounts'::regclass AND contype = 'u'
     AND pg_get_constraintdef(oid) = 'UNIQUE (organization_id, linea)';
  IF c IS NOT NULL THEN EXECUTE format('ALTER TABLE accounts DROP CONSTRAINT %I', c); END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_org_linea_uq ON accounts (organization_id, linea) WHERE linea <> 'PP';
CREATE UNIQUE INDEX IF NOT EXISTS accounts_pp_punto_uq ON accounts (organization_id, coalesce(pp_site_id, 0), lower(coalesce(pp_nome, ''))) WHERE linea = 'PP';
CREATE UNIQUE INDEX IF NOT EXISTS accounts_pp_site_uq ON accounts (pp_site_id) WHERE pp_site_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS accounts_pp_avvio_idx ON accounts (linea) WHERE pp_avvio_at IS NOT NULL;

-- Diario: passi dell'avvio del punto prelievi (primo ordine, attesa della sede o della data, riepilogo)
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_tipo_check;
ALTER TABLE activities ADD CONSTRAINT activities_tipo_check
  CHECK (tipo IN ('CHIAMATA','EMAIL_IN','EMAIL_OUT','INCONTRO','SOPRALLUOGO','NOTA','OFFERTA','CRITICITA','SISTEMA','PACCHETTO',
                  'LISTINO','OFFERTA_ECONOMICA','ACCESSO','KIT','FORM_B2B','CONTRATTO_FIRMATO','ATTIVAZIONE','AVVIO'));

-- Invio del contratto al partner: stessa tabella del kit di proposta (preparazione, anteprima, invio con conferma, idempotenza)
ALTER TABLE kit_proposta ADD COLUMN IF NOT EXISTS variante TEXT NOT NULL DEFAULT 'KIT';
ALTER TABLE kit_proposta DROP CONSTRAINT IF EXISTS kit_proposta_variante_check;
ALTER TABLE kit_proposta ADD CONSTRAINT kit_proposta_variante_check CHECK (variante IN ('KIT','CONTRATTO_PARTNER'));
ALTER TABLE kit_proposta ADD COLUMN IF NOT EXISTS contract_id INT REFERENCES contracts(id) ON DELETE SET NULL;
ALTER TABLE kit_proposta ADD COLUMN IF NOT EXISTS contract_file_id INT REFERENCES contract_files(id) ON DELETE SET NULL;
