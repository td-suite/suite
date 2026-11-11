-- Label · etichette provette (schema "etichette" della Suite, search_path = etichette, public). v0.69.0, richiesta del CEO del 10/11/2026:
-- dal numero di accettazione o dal cognome del paziente, anteprima delle etichette per provetta (una per campione della copia Synclab) e
-- stampa sulla Zebra della sede con Zebra Browser Print (docs/ETICHETTE.md).
-- Dati del paziente: SOLO in pazienti_recenti (cognome, nome, nascita, sesso delle accettazioni degli ultimi N giorni, impostazione
-- giorni_identita, purga quotidiana). Il codice fiscale NON si conserva (colonna vincolata a NULL). Il registro delle stampe non ha
-- dati del paziente. Migrazione idempotente: IF NOT EXISTS ovunque, semi con ON CONFLICT / WHERE NOT EXISTS.

-- Riga tecnica dell'utente del modulo (adattatore moduleUser della Suite): il ruolo è il profilo del grant (ADMIN | OPERATORE)
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  role        TEXT NOT NULL DEFAULT 'OPERATORE',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Impostazioni del modulo (chiave → valore JSON); i predefiniti in lib/core.js (DEFAULTS)
CREATE TABLE IF NOT EXISTS impostazioni (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Modelli dell'etichetta: ZPL con segnaposto, misure del rotolo e risoluzione della stampante. validato_il/validato_da: confronto con
-- l'etichetta di StudioLab e lettura con gli strumenti del laboratorio (finché nessun modello attivo è validato il modulo lo avvisa).
CREATE TABLE IF NOT EXISTS modelli (
  id           SERIAL PRIMARY KEY,
  nome         TEXT NOT NULL,
  larghezza_mm NUMERIC(6,2) NOT NULL CHECK (larghezza_mm BETWEEN 10 AND 120),
  altezza_mm   NUMERIC(6,2) NOT NULL CHECK (altezza_mm BETWEEN 5 AND 200),
  dpi          INT NOT NULL DEFAULT 203 CHECK (dpi IN (203, 300)),
  zpl          TEXT NOT NULL,
  attivo       BOOLEAN NOT NULL DEFAULT TRUE,
  predefinito  BOOLEAN NOT NULL DEFAULT FALSE,
  note         TEXT,
  validato_il  TIMESTAMPTZ,
  validato_da  INT REFERENCES public.users(id) ON DELETE SET NULL,
  validazione_nota TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by   INT REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS modelli_un_predefinito ON modelli (predefinito) WHERE predefinito;

-- Modello per sede (Impostazioni): senza riga vale il modello predefinito
CREATE TABLE IF NOT EXISTS modelli_sede (
  site_id    INT PRIMARY KEY REFERENCES public.sites(id) ON DELETE CASCADE,
  modello_id INT NOT NULL REFERENCES modelli(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Identità recenti: cognome, nome, nascita, sesso delle accettazioni ATTIVE degli ultimi N giorni (dettaglio opt-in della Data API, una
-- accettazione alla volta). Servono alla ricerca per cognome e alla stampa. cf resta sempre NULL: il codice fiscale non si conserva.
CREATE TABLE IF NOT EXISTS pazienti_recenti (
  instance_id     TEXT NOT NULL,
  request_id      TEXT NOT NULL,
  request_number  TEXT,
  data_accettazione DATE,
  cognome         TEXT,
  nome            TEXT,
  nascita         DATE,
  sesso           TEXT,
  cf              TEXT CHECK (cf IS NULL),
  letto_il        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, request_id)
);
CREATE INDEX IF NOT EXISTS pazienti_recenti_cognome ON pazienti_recenti (lower(cognome) text_pattern_ops);
CREATE INDEX IF NOT EXISTS pazienti_recenti_letto ON pazienti_recenti (letto_il);

-- Accettazioni lette direttamente dal gestionale (GET /api/v1/data/requests?requestNumber=… o sampleBarcode=…) perché non ancora nella
-- copia Synclab (accettazione di pochi minuti fa): testata, righe e campioni SENZA il paziente; la copia, quando arriva, prevale.
-- Si purgano con le identità.
CREATE TABLE IF NOT EXISTS accettazioni_dirette (
  instance_id    TEXT NOT NULL,
  id             TEXT NOT NULL,
  request_number TEXT,
  data           DATE,
  client_id      TEXT,
  raw            JSONB NOT NULL,
  letto_il       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, id)
);
CREATE INDEX IF NOT EXISTS accettazioni_dirette_numero ON accettazioni_dirette (request_number);

-- Registro delle stampe (nessun dato del paziente): chi, quando, sede, accettazione, etichette, copie, stampante, esito, ristampa
CREATE TABLE IF NOT EXISTS stampe (
  id             SERIAL PRIMARY KEY,
  at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id        INT REFERENCES public.users(id) ON DELETE SET NULL,
  site_id        INT REFERENCES public.sites(id) ON DELETE SET NULL,
  instance_id    TEXT,
  request_id     TEXT,
  request_number TEXT,
  n_etichette    INT NOT NULL DEFAULT 0 CHECK (n_etichette >= 0),
  copie          INT NOT NULL DEFAULT 1 CHECK (copie BETWEEN 1 AND 20),
  stampante      TEXT,
  metodo         TEXT NOT NULL DEFAULT 'ZEBRA' CHECK (metodo IN ('ZEBRA','PDF','PROVA')),
  esito          TEXT NOT NULL CHECK (esito IN ('OK','ERRORE')),
  errore         TEXT,
  ristampa       BOOLEAN NOT NULL DEFAULT FALSE,
  modello_id     INT REFERENCES modelli(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS stampe_at ON stampe (at DESC);
CREATE INDEX IF NOT EXISTS stampe_richiesta ON stampe (instance_id, request_id);

-- Stato dei lavori di sfondo (persistente: la Diagnostica D55 lo legge)
CREATE TABLE IF NOT EXISTS job_stato (
  nome         TEXT PRIMARY KEY,
  ultimo_giro  TIMESTAMPTZ,
  ultimo_ok    TIMESTAMPTZ,
  ultima_purga DATE,
  esito        JSONB,
  errore       TEXT
);

-- Modello predefinito "TD 50x25 (da validare)": 50 × 25 mm a 203 dpi (400 × 200 dot). Code 128 del barcode del campione con il testo in
-- chiaro, cognome e nome (troncati), nascita e sesso, accettazione, contenitore e materiale, data e ora, numero dell'etichetta.
-- DA VALIDARE: va confrontato con l'etichetta di StudioLab (foto/PDF e misure del rotolo dal CEO) e letto dagli strumenti del laboratorio.
INSERT INTO modelli (nome, larghezza_mm, altezza_mm, dpi, zpl, attivo, predefinito, note)
SELECT 'TD 50x25 (da validare)', 50, 25, 203, $zpl$^XA
^FX Modello TD 50x25 (da validare): confrontare con l'etichetta di StudioLab prima dell'uso
^CI28
^PW400
^LL200
^LH0,0
^FO16,8^A0N,26,24^FB370,1,0,L^FD{COGNOME:18} {NOME:14}^FS
^FO16,36^A0N,20,20^FDn. {NASCITA} {SESSO}^FS
^FO200,36^A0N,20,20^FB184,1,0,R^FDAcc. {ACCETTAZIONE:14}^FS
^FO16,60^BY2,3,62^BCN,62,Y,N,N,A^FD{BARCODE}^FS
^FO16,150^A0N,20,20^FB370,1,0,L^FD{CONTENITORE:20} {MATERIALE:14}^FS
^FO16,174^A0N,18,18^FD{DATA} {ORA}^FS
^FO300,174^A0N,18,18^FB84,1,0,R^FD{N}/{TOT}^FS
^XZ$zpl$, TRUE, TRUE, 'Default ragionevole in attesa del disegno di StudioLab (foto/PDF e misure del rotolo dal CEO). Non usare sulle provette prima della validazione.'
WHERE NOT EXISTS (SELECT 1 FROM modelli);

-- ADMIN del modulo al titolare (una volta, all'avvio del modulo): il seme della Suite dà i grant solo al titolare appena creato
INSERT INTO public.grants (user_id, module_key, profile, source)
SELECT u.id, 'etichette', 'ADMIN', 'SEED' FROM public.users u
 WHERE u.level = 'OWNER' AND u.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM public.modules m WHERE m.key = 'etichette')
ON CONFLICT (user_id, module_key) DO NOTHING;
