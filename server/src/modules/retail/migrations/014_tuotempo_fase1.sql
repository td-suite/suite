-- TuoTempo, Fase 1 del piano di integrazione (richiesta del CEO del 09/11/2026: "Le sedi sono sedi, su Retail, ovunque. E devono quadrare
-- con TuoTempo"). Anagrafiche complete dalle Key Entities: aree (centri) con l'abbinamento alle sedi dell'anagrafica unica, attività con la
-- prima disponibilità giornaliera, risorse (medici e macchine) con l'abbinamento alle persone, assicurazioni e convenzioni.
-- Regole: la fonte dell'abbinamento area ↔ sede è public.sites.legacy_refs->>'tuotempo' (scritto solo da saveSite); retail.site_ext.
-- tuotempo_area_id resta come specchio. La fonte dell'abbinamento risorsa ↔ persona è public.people.legacy_refs->>'tuotempo'.
-- Idempotente e non distruttiva: solo tabelle e colonne nuove (IF NOT EXISTS), nessun dato cancellato o riscritto.

-- Aree TuoTempo (una riga per areaid, aggiornata a ogni allineamento). ignorata = "non nostra / ignora" deciso per area.
CREATE TABLE IF NOT EXISTS tuotempo_aree (
  areaid          TEXT PRIMARY KEY,
  titolo          TEXT,
  web_title       TEXT,
  indirizzo       TEXT,
  cap             TEXT,
  citta           TEXT,
  provincia       TEXT,
  regione         TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  mobile          TEXT,
  landline        TEXT,
  opening_hrs     TEXT,                 -- testo degli orari come pubblicato su TuoTempo
  orari_norm      TEXT,                 -- stesso testo riscritto nel formato della Suite (hoursText) se interpretabile, altrimenti NULL
  tags            TEXT,
  legacyid        TEXT,
  is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,   -- isHidden = 1: area nascosta alla prenotazione online
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  presente        BOOLEAN NOT NULL DEFAULT TRUE,    -- FALSE se all'ultimo allineamento TuoTempo non la restituisce più
  ignorata        BOOLEAN NOT NULL DEFAULT FALSE,   -- "non nostra / ignora" (impostazione per area)
  ignorata_nota   TEXT,
  ignorata_da     INT,
  ignorata_at     TIMESTAMPTZ,
  attivita        JSONB NOT NULL DEFAULT '[]'::jsonb,   -- activityid prenotabili nell'area (activities?areaid=)
  dati            JSONB,                -- riga ricevuta (solo i campi chiesti con fields)
  prima_vista_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Storico giornaliero della prima disponibilità per attività (una riga per giorno e attività; la sede è quella dell'area del primo slot).
CREATE TABLE IF NOT EXISTS tuotempo_attivita (
  data            DATE NOT NULL,
  activityid      TEXT NOT NULL,
  areaid          TEXT,                 -- area del primo slot (first_availability_areaTitle riconosciuto tra le aree)
  site_id         INT REFERENCES public.sites(id) ON DELETE SET NULL,
  typologyid      TEXT,
  first_availability TIMESTAMPTZ,
  giorni_attesa   NUMERIC(8,2),         -- giorni dal momento dell'allineamento al primo slot libero
  PRIMARY KEY (data, activityid)
);
CREATE INDEX IF NOT EXISTS tuotempo_attivita_site_idx ON tuotempo_attivita (site_id, data);

-- Risorse (medici, professionisti, macchine) con la proposta di abbinamento alle persone dell'anagrafica unica
CREATE TABLE IF NOT EXISTS tuotempo_risorse (
  resourceid      TEXT PRIMARY KEY,
  name            TEXT,
  email           TEXT,
  phone           TEXT,
  status          TEXT,                 -- 'a' = attiva
  is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,
  is_machine      BOOLEAN NOT NULL DEFAULT FALSE,
  satisfaction    NUMERIC(6,2),
  areas           JSONB NOT NULL DEFAULT '[]'::jsonb,   -- areaid in cui lavora
  legacyid        TEXT,
  idnumber        TEXT,
  presente        BOOLEAN NOT NULL DEFAULT TRUE,
  proposta_person_id INT REFERENCES public.people(id) ON DELETE SET NULL,   -- proposta automatica (email, poi nome)
  proposta_come   TEXT,                 -- EMAIL | NOME
  person_id       INT REFERENCES public.people(id) ON DELETE SET NULL,      -- abbinamento confermato (specchio di people.legacy_refs->>'tuotempo')
  confermata_at   TIMESTAMPTZ,
  confermata_da   INT,
  dati            JSONB,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tuotempo_risorse_person_idx ON tuotempo_risorse (person_id) WHERE person_id IS NOT NULL;

-- Assicurazioni e convenzioni pubblicate su TuoTempo
CREATE TABLE IF NOT EXISTS tuotempo_assicurazioni (
  insuranceid     TEXT PRIMARY KEY,
  titolo          TEXT,
  legacyid        TEXT,
  legacy_title    TEXT,
  is_default      BOOLEAN NOT NULL DEFAULT FALSE,
  is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,
  tags            TEXT,
  presente        BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Attività TuoTempo sul catalogo prestazioni: i campi di TuoTempo stanno accanto al listino privato (price resta del listino della Suite)
ALTER TABLE products ADD COLUMN IF NOT EXISTS tt_activity_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tt_typology_id TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tt_typology TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tt_price NUMERIC(10,2);
ALTER TABLE products ADD COLUMN IF NOT EXISTS tt_price_rules JSONB;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tt_preparation TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tt_hidden BOOLEAN;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tt_first_availability TIMESTAMPTZ;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tt_first_availability_area TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tt_legacyid TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS tt_synced_at TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS products_tt_activity_uq ON products (tt_activity_id) WHERE tt_activity_id IS NOT NULL;

-- Normalizzazione dei testi per il confronto con l'anagrafica (indirizzi, città): minuscole, senza accenti, abbreviazioni comuni sciolte,
-- senza punteggiatura né spazi. Usata dall'abbinamento (indirizzo + CAP) e dal controllo "Sedi con dati diversi da TuoTempo".
CREATE OR REPLACE FUNCTION tt_norm(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(regexp_replace(
           regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
             lower(translate(coalesce(t, ''), 'àáâäèéêëìíîïòóôöùúûüÀÁÂÄÈÉÊËÌÍÎÏÒÓÔÖÙÚÛÜ''’', 'aaaaeeeeiiiioooouuuuAAAAEEEEIIIIOOOOUUUU  ')),
           '\m(v\.le|vle)\M', 'viale', 'g'), '\m(p\.zza|p\.za|pza|pzza)\M', 'piazza', 'g'), '\m(v\.|v)\s', 'via ', 'g'), '\m(c\.so|cso)\M', 'corso', 'g'), '\ms\.\s*', 'san ', 'g'),
         '[^a-z0-9]', '', 'g'), '')
$$;
-- Nome per la somiglianza (proposta per nome): senza le parole comuni a tutte le sedi (punto, prelievi, centro, medico, ...), così
-- "Punto Prelievi Livorno" non somiglia a "Punto Prelievi Empoli"
CREATE OR REPLACE FUNCTION tt_nome(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(regexp_replace(regexp_replace(lower(translate(coalesce(t, ''), 'àáâäèéêëìíîïòóôöùúûü', 'aaaaeeeeiiiioooouuuu')),
    '\m(punto|punti|prelievi|prelievo|pp|centro|centri|medico|medica|diagnostico|diagnostica|poliambulatorio|ambulatorio|sede|td|toscana|di|del|della|dei|in|agenda|storica|cm|pol|cd)\M', ' ', 'g'), '\s+', ' ', 'g'))
$$;
-- Telefono: solo cifre, senza prefisso internazionale italiano
CREATE OR REPLACE FUNCTION tt_tel(t TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(regexp_replace(regexp_replace(coalesce(t, ''), '[^0-9]', '', 'g'), '^(0039|39)(?=\d{9,11}$)', ''), '')
$$;

-- Confronto dei dati tra TuoTempo e l'anagrafica per le sedi abbinate (fonte dell'abbinamento: public.sites.legacy_refs->>'tuotempo').
-- Una differenza conta solo se TuoTempo ha il dato (un campo vuoto su TuoTempo non è una differenza da copiare). Una sola regola per la
-- tabella "Aree TuoTempo" e per il controllo della Diagnostica "Sedi con dati diversi da TuoTempo".
CREATE OR REPLACE VIEW tuotempo_confronto_v AS
  SELECT s.id AS site_id, s.code, s.name, s.active, a.areaid, a.titolo, a.is_hidden,
         a.indirizzo AS tt_indirizzo, s.address AS indirizzo, a.cap AS tt_cap, s.zip AS cap, a.citta AS tt_citta, s.city AS citta,
         coalesce(nullif(a.landline, ''), a.mobile) AS tt_telefono, s.phone AS telefono,
         a.opening_hrs AS tt_orari, a.orari_norm AS tt_orari_norm, s.opening_hours AS orari,
         (tt_norm(a.indirizzo) IS NOT NULL AND tt_norm(a.indirizzo) IS DISTINCT FROM tt_norm(s.address)) AS diff_indirizzo,
         (nullif(regexp_replace(coalesce(a.cap, ''), '\D', '', 'g'), '') IS NOT NULL
           AND nullif(regexp_replace(coalesce(a.cap, ''), '\D', '', 'g'), '') IS DISTINCT FROM nullif(regexp_replace(coalesce(s.zip, ''), '\D', '', 'g'), '')) AS diff_cap,
         (tt_norm(a.citta) IS NOT NULL AND tt_norm(a.citta) IS DISTINCT FROM tt_norm(s.city)) AS diff_citta,
         (coalesce(tt_tel(a.landline), tt_tel(a.mobile)) IS NOT NULL
           AND NOT (coalesce(tt_tel(s.phone) = tt_tel(a.landline), FALSE) OR coalesce(tt_tel(s.phone) = tt_tel(a.mobile), FALSE))) AS diff_telefono,
         (a.orari_norm IS NOT NULL AND a.orari_norm IS DISTINCT FROM s.opening_hours) AS diff_orari,
         (a.opening_hrs IS NOT NULL AND btrim(a.opening_hrs) <> '' AND a.orari_norm IS NULL) AS orari_non_interpretabili
    FROM public.sites s JOIN tuotempo_aree a ON a.areaid = s.legacy_refs->>'tuotempo'
   WHERE a.presente;

INSERT INTO public.audit_log (action, entity, entity_id, label, data)
SELECT 'MIGRAZIONE_RAPPORTO', 'migration', 'retail/014_tuotempo_fase1.sql', 'Retail: TuoTempo Fase 1 (aree ↔ sedi, attività, risorse, assicurazioni)',
       jsonb_build_object('sedi_con_area_nello_specchio', (SELECT count(*) FROM site_ext WHERE tuotempo_area_id IS NOT NULL),
                          'sedi_con_area_nella_fonte', (SELECT count(*) FROM public.sites WHERE legacy_refs ? 'tuotempo'));
