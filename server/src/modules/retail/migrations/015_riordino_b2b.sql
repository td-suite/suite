-- Riordino di Retail (decisione del CEO del 09/11/2026 sera): cruscotto complessivo e due sezioni, B2C (TuoTempo + GIPO) e B2B (StudioLab).
-- 1) Impostazione `synclab_privati_in_b2c` (predefinita true): le accettazioni Synclab dei client abbinati a una sede TD vanno nel B2C come
--    "Laboratorio in sede"; con false tutto Synclab è B2B. Inserita solo se manca (una scelta già salvata resta).
-- 2) Budget B2B: la tabella budgets esistente ha solo le dimensioni linea e sede (nessuna dimensione per cliente B2B), quindi gli obiettivi
--    per cliente e mese su produzione e fatturato stanno in una tabella nuova. Cliente = Legal entity (organization_id) oppure, per un client
--    Synclab non ancora abbinato, la sua chiave 'c-<id del client>' con il nome in chiaro.
-- Idempotente e non distruttiva: solo oggetti nuovi (IF NOT EXISTS) e una riga di impostazione con ON CONFLICT DO NOTHING.

INSERT INTO app_settings (key, value) VALUES ('synclab_privati_in_b2c', 'true') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS budget_b2b (
  id              SERIAL PRIMARY KEY,
  chiave          TEXT NOT NULL,                 -- id della Legal entity in testo, oppure 'c-<id client Synclab>'
  organization_id INT REFERENCES public.organizations(id) ON DELETE CASCADE,
  cliente         TEXT,                          -- nome del client Synclab quando non c'è la Legal entity
  anno            INT NOT NULL CHECK (anno BETWEEN 2000 AND 2100),
  mese            INT NOT NULL CHECK (mese BETWEEN 1 AND 12),
  produzione      NUMERIC(14,2),                 -- obiettivo di valore della produzione (netti di riga Synclab), euro
  fatturato       NUMERIC(14,2),                 -- obiettivo di fatturato da documenti, euro
  esami           INT,                           -- obiettivo di esami (righe), facoltativo
  note            TEXT,
  updated_by      INT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chiave, anno, mese)
);
CREATE INDEX IF NOT EXISTS budget_b2b_anno_idx ON budget_b2b (anno, mese);
