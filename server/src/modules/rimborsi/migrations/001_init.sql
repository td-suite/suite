-- Rimborso Spese (schema "rimborsi" della Suite, search_path = rimborsi, public). v0.72.0, richiesta del CEO del 13/11/2026: nota spese
-- mensile del dipendente con due sezioni nella stessa scheda, Spese (modulo TD-SGI-MOD025) e Chilometri (TD-SGI-MOD029), giustificativi
-- fotografati dal telefono, invio al responsabile dell'organigramma, approvazione, liquidazione di P&C, archivio (docs/RIMBORSI.md).
-- Nessun importo di policy e nessuna tariffa nel seme: massimali vuoti, tariffa chilometrica predefinita vuota.
-- Migrazione idempotente: IF NOT EXISTS ovunque, semi con ON CONFLICT DO NOTHING.

-- Riga tecnica dell'utente del modulo (adattatore moduleUser della Suite): il ruolo è sempre DIPENDENTE, i ruoli veri si calcolano
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'DIPENDENTE',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Impostazioni (chiave → valore JSON); i predefiniti in lib/core.js (DEFAULTS)
CREATE TABLE IF NOT EXISTS impostazioni (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Categorie di spesa (configurabili da P&C). Massimali vuoti di default: nessun importo di policy inventato.
-- tipo: SPESA (sezione Spese, MOD025) | PEDAGGIO e PARCHEGGIO (riepilogo della sezione Chilometri, MOD029) | CARBURANTE (spesa).
CREATE TABLE IF NOT EXISTS categorie (
  id                       SERIAL PRIMARY KEY,
  codice                   TEXT NOT NULL UNIQUE,
  nome                     TEXT NOT NULL,
  tipo                     TEXT NOT NULL DEFAULT 'SPESA' CHECK (tipo IN ('SPESA','PEDAGGIO','PARCHEGGIO','CARBURANTE')),
  massimale_spesa          NUMERIC(10,2) CHECK (massimale_spesa IS NULL OR massimale_spesa > 0),
  massimale_giorno         NUMERIC(10,2) CHECK (massimale_giorno IS NULL OR massimale_giorno > 0),
  giustificativo_obbligatorio BOOLEAN NOT NULL DEFAULT TRUE,
  attiva                   BOOLEAN NOT NULL DEFAULT TRUE,
  ordine                   INT NOT NULL DEFAULT 100,
  note                     TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO categorie (codice, nome, tipo, ordine) VALUES
  ('VITTO', 'Vitto', 'SPESA', 10),
  ('ALLOGGIO', 'Alloggio', 'SPESA', 20),
  ('TRASPORTI', 'Trasporti pubblici', 'SPESA', 30),
  ('TAXI', 'Taxi/NCC', 'SPESA', 40),
  ('CARBURANTE', 'Carburante', 'CARBURANTE', 50),
  ('PEDAGGI', 'Pedaggi', 'PEDAGGIO', 60),
  ('PARCHEGGI', 'Parcheggi', 'PARCHEGGIO', 70),
  ('RAPPRESENTANZA', 'Rappresentanza', 'SPESA', 80),
  ('CONSUMO', 'Materiale di consumo', 'SPESA', 90),
  ('FORMAZIONE', 'Formazione', 'SPESA', 100),
  ('ALTRO', 'Altro', 'SPESA', 110)
ON CONFLICT (codice) DO NOTHING;

-- Veicoli PROPRI del dipendente (profilo): marca, modello, targa, tariffa EUR/km dalle tabelle ACI inserita dal dipendente o da P&C
CREATE TABLE IF NOT EXISTS veicoli (
  id            SERIAL PRIMARY KEY,
  person_id     INT NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  marca         TEXT NOT NULL,
  modello       TEXT NOT NULL,
  targa         TEXT NOT NULL,
  alimentazione TEXT,
  tariffa       NUMERIC(8,4) CHECK (tariffa IS NULL OR (tariffa > 0 AND tariffa < 10)),
  tariffa_fonte TEXT,                        -- es. "tabelle ACI 2026, <modello>": obbligatoria con la tariffa
  attivo        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    INT REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by    INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS veicoli_persona ON veicoli (person_id);

-- Nota spese mensile: una per dipendente e mese. Totali ricalcolati a ogni modifica (lib/calcoli.js), congelati dopo la liquidazione.
-- Stati: BOZZA → INVIATA → APPROVATA → IN_LIQUIDAZIONE → LIQUIDATA → ARCHIVIATA (RESPINTA = ritorno in BOZZA con l'evento).
CREATE TABLE IF NOT EXISTS note (
  id                      SERIAL PRIMARY KEY,
  person_id               INT NOT NULL REFERENCES public.people(id) ON DELETE RESTRICT,
  anno                    INT NOT NULL CHECK (anno BETWEEN 2020 AND 2100),
  mese                    INT NOT NULL CHECK (mese BETWEEN 1 AND 12),
  stato                   TEXT NOT NULL DEFAULT 'BOZZA' CHECK (stato IN ('BOZZA','INVIATA','APPROVATA','IN_LIQUIDAZIONE','LIQUIDATA','ARCHIVIATA')),
  motivazione             TEXT,                -- motivazione generale (trasferta) della nota
  anticipi                NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (anticipi >= 0),
  note                    TEXT,
  tot_spese               NUMERIC(10,2) NOT NULL DEFAULT 0,   -- spese documentate anticipate dal dipendente (MOD025, senza pedaggi e parcheggi)
  tot_km                  NUMERIC(10,1) NOT NULL DEFAULT 0,   -- km rimborsabili del mese
  tot_km_importo          NUMERIC(10,2) NOT NULL DEFAULT 0,   -- rimborso chilometrico (MOD029)
  tot_pedaggi             NUMERIC(10,2) NOT NULL DEFAULT 0,
  tot_parcheggi           NUMERIC(10,2) NOT NULL DEFAULT 0,
  tot_carta               NUMERIC(10,2) NOT NULL DEFAULT 0,   -- pagato con carta aziendale o fuel card: non rimborsabile
  tot_escluso             NUMERIC(10,2) NOT NULL DEFAULT 0,   -- righe escluse dal responsabile
  tot_rimborsabile        NUMERIC(10,2) NOT NULL DEFAULT 0,
  saldo                   NUMERIC(10,2) NOT NULL DEFAULT 0,   -- > 0 a favore del dipendente, < 0 a favore dell'azienda
  responsabile_person_id  INT REFERENCES public.people(id) ON DELETE SET NULL,   -- congelato all'invio
  responsabile_origine    TEXT,
  al_pc                   BOOLEAN NOT NULL DEFAULT FALSE,   -- vertice senza superiore: approva P&C come secondo controllo
  inviata_at              TIMESTAMPTZ,
  inviata_da              INT REFERENCES public.users(id) ON DELETE SET NULL,
  in_ritardo              BOOLEAN NOT NULL DEFAULT FALSE,
  approvata_at            TIMESTAMPTZ,
  approvata_da            INT REFERENCES public.users(id) ON DELETE SET NULL,
  approvata_person_id     INT REFERENCES public.people(id) ON DELETE SET NULL,
  presa_in_carico_at      TIMESTAMPTZ,
  presa_in_carico_da      INT REFERENCES public.users(id) ON DELETE SET NULL,
  liquidata_at            TIMESTAMPTZ,
  liquidata_da            INT REFERENCES public.users(id) ON DELETE SET NULL,
  liquidazione_data       DATE,
  liquidazione_importo    NUMERIC(10,2),
  liquidazione_rif        TEXT,                -- riferimento del cedolino o del bonifico
  archiviata_at           TIMESTAMPTZ,
  archiviata_da           INT REFERENCES public.users(id) ON DELETE SET NULL,
  pdf_allegato_id         INT,                 -- PDF definitivo (allegati.id, riga_tipo NOTA)
  promemoria_at           TIMESTAMPTZ,
  versione                INT NOT NULL DEFAULT 1,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (person_id, anno, mese)
);
CREATE INDEX IF NOT EXISTS note_stato ON note (stato);
CREATE INDEX IF NOT EXISTS note_responsabile ON note (responsabile_person_id) WHERE stato = 'INVIATA';

-- Sezione Spese (MOD025)
CREATE TABLE IF NOT EXISTS spese (
  id              SERIAL PRIMARY KEY,
  nota_id         INT NOT NULL REFERENCES note(id) ON DELETE CASCADE,
  data            DATE NOT NULL,
  descrizione     TEXT NOT NULL,
  categoria_id    INT NOT NULL REFERENCES categorie(id),
  importo         NUMERIC(10,2) NOT NULL CHECK (importo > 0),
  valuta          TEXT NOT NULL DEFAULT 'EUR' CHECK (valuta = 'EUR'),
  metodo          TEXT NOT NULL DEFAULT 'DIPENDENTE' CHECK (metodo IN ('DIPENDENTE','CARTA_AZIENDALE','FUEL_CARD')),
  fuel_card_id    INT,                         -- contracts.benefit_fuel_card.id (metodo FUEL_CARD)
  motivazione     TEXT,
  cliente_org_id  INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  progetto        TEXT,
  viaggio_id      INT,                         -- pedaggio o parcheggio collegato a un viaggio della sezione Chilometri
  esclusa         BOOLEAN NOT NULL DEFAULT FALSE,
  esclusa_motivo  TEXT,
  esclusa_da      INT REFERENCES public.users(id) ON DELETE SET NULL,
  esclusa_at      TIMESTAMPTZ,
  created_by      INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS spese_nota ON spese (nota_id);

-- Sezione Chilometri (MOD029): km = percorso di sola andata, km_totali = doppio con andata e ritorno; importo = km_totali × tariffa
CREATE TABLE IF NOT EXISTS viaggi (
  id              SERIAL PRIMARY KEY,
  nota_id         INT NOT NULL REFERENCES note(id) ON DELETE CASCADE,
  data            DATE NOT NULL,
  partenza        TEXT NOT NULL,
  arrivo          TEXT NOT NULL,
  andata_ritorno  BOOLEAN NOT NULL DEFAULT FALSE,
  motivazione     TEXT,
  km              NUMERIC(8,1) NOT NULL CHECK (km > 0 AND km < 5000),
  km_totali       NUMERIC(8,1) NOT NULL,
  veicolo_tipo    TEXT NOT NULL DEFAULT 'PROPRIO' CHECK (veicolo_tipo IN ('PROPRIO','AZIENDALE')),
  veicolo_id      INT REFERENCES veicoli(id) ON DELETE SET NULL,
  vettura_id      INT,                         -- contracts.benefit_vetture.id (veicolo AZIENDALE)
  veicolo_testo   TEXT,                        -- marca, modello e targa congelati sulla riga
  tariffa         NUMERIC(8,4),                -- congelata sulla riga; NULL = manca: la riga non si invia
  tariffa_fonte   TEXT,
  importo         NUMERIC(10,2) NOT NULL DEFAULT 0,
  rimborsabile    BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE per la vettura aziendale (registro dei viaggi di servizio)
  cliente_org_id  INT REFERENCES public.organizations(id) ON DELETE SET NULL,
  progetto        TEXT,
  esclusa         BOOLEAN NOT NULL DEFAULT FALSE,
  esclusa_motivo  TEXT,
  esclusa_da      INT REFERENCES public.users(id) ON DELETE SET NULL,
  esclusa_at      TIMESTAMPTZ,
  created_by      INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS viaggi_nota ON viaggi (nota_id);

-- Giustificativi (foto dello scontrino, PDF della ricevuta) e PDF definitivo della nota. Archivio a due vie (lib/moduleStorage.js):
-- Azure Blob se configurato, altrimenti bytea. Non eliminabili dopo l'invio (controllo nelle route).
CREATE TABLE IF NOT EXISTS allegati (
  id           SERIAL PRIMARY KEY,
  nota_id      INT NOT NULL REFERENCES note(id) ON DELETE CASCADE,
  riga_tipo    TEXT NOT NULL CHECK (riga_tipo IN ('SPESA','VIAGGIO','NOTA')),
  riga_id      INT,
  filename     TEXT NOT NULL,
  mime         TEXT,
  size         INT NOT NULL,
  sha256       TEXT NOT NULL,
  data         BYTEA,
  blob_path    TEXT,
  larghezza    INT,
  altezza      INT,
  caricato_da  INT REFERENCES public.users(id) ON DELETE SET NULL,
  caricato_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS allegati_nota ON allegati (nota_id, riga_tipo, riga_id);

-- Eccezioni al giustificativo obbligatorio (gestite da P&C e titolare). person_id NULL = voce del seme non abbinata (Diagnostica D58).
CREATE TABLE IF NOT EXISTS eccezioni (
  id            SERIAL PRIMARY KEY,
  person_id     INT REFERENCES public.people(id) ON DELETE CASCADE,
  cognome_seme  TEXT,
  origine       TEXT NOT NULL DEFAULT 'MANUALE' CHECK (origine IN ('SEME','MANUALE')),
  nota          TEXT,
  created_by    INT REFERENCES public.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS eccezioni_persona ON eccezioni (person_id) WHERE person_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS eccezioni_seme ON eccezioni (lower(cognome_seme)) WHERE origine = 'SEME';

-- Storico completo della nota: chi, cosa, quando, nota
CREATE TABLE IF NOT EXISTS eventi (
  id         SERIAL PRIMARY KEY,
  nota_id    INT NOT NULL REFERENCES note(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL,
  user_id    INT REFERENCES public.users(id) ON DELETE SET NULL,
  person_id  INT REFERENCES public.people(id) ON DELETE SET NULL,
  testo      TEXT,
  dati       JSONB NOT NULL DEFAULT '{}'::jsonb,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS eventi_nota ON eventi (nota_id, at);
