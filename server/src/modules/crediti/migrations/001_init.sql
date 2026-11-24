-- Recupero Crediti (v0.95.0, CEO 24/11/2026). Processo dal memo "Modello di sollecito clienti B2B" (Amministrazione e Finanza):
-- avviso a -7 giorni, 1° sollecito a +10, 2° sollecito a +25 (email e PEC, firma RAF), chiamata del referente commerciale a +35,
-- area legale a +60 su autorizzazione. Fatture da Synclab e dal partitario della contabilità, incassi dalla banca (Enable Banking),
-- comunicazioni e risposte dalla casella amministrazione@. Nessun dato sanitario: solo documenti economici di clienti B2B.
CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  full_name  TEXT,
  role       TEXT NOT NULL DEFAULT 'VIEWER',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS impostazioni (
  key        TEXT PRIMARY KEY,
  value      JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT
);
-- Scheda del cliente nel recupero crediti (una riga per Legal entity, creata quando serve)
CREATE TABLE IF NOT EXISTS clienti (
  organization_id   INT PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  escluso           BOOLEAN NOT NULL DEFAULT FALSE,     -- nessun sollecito: lo decidono solo CEO e CFO
  esclusione_motivo TEXT,
  esclusione_fino   DATE,                               -- NULL = fino a revoca
  esclusa_da        INT, esclusa_at TIMESTAMPTZ,
  email_solleciti   TEXT,                               -- destinatari scelti a mano (vincono sui contatti del Business Hub)
  pec               TEXT,                               -- PEC per il 2° sollecito (vince su quella della Legal entity)
  termini           TEXT,                               -- termini di pagamento per la scadenza (vincono su quelli del Business Hub)
  referente_user_id INT,                                -- referente commerciale (vince sul titolare dell'account del Business Hub)
  sospeso_fino      DATE,                               -- scala sospesa a mano fino a questa data
  sospeso_motivo    TEXT,
  note              TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS esclusioni_log (
  id              SERIAL PRIMARY KEY,
  organization_id INT NOT NULL,
  azione          TEXT NOT NULL CHECK (azione IN ('ESCLUSO','RIAMMESSO')),
  motivo          TEXT,
  fino            DATE,
  user_id         INT,
  at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- IBAN da cui un cliente ha già pagato (imparati dalle riconciliazioni confermate): aiutano a riconoscere i bonifici successivi
CREATE TABLE IF NOT EXISTS clienti_iban (
  iban            TEXT PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fatture (
  id               SERIAL PRIMARY KEY,
  fonte            TEXT NOT NULL CHECK (fonte IN ('SYNCLAB','CONTABILITA','MANUALE')),
  fonte_id         TEXT NOT NULL,
  organization_id  INT REFERENCES public.organizations(id) ON DELETE SET NULL,   -- NULL = cliente del file non ancora abbinato a una Legal entity
  cliente_nome     TEXT,                              -- come scritto nella fonte
  cliente_piva     TEXT,
  numero           TEXT NOT NULL,
  data             DATE NOT NULL,
  scadenza         DATE NOT NULL,
  scadenza_origine TEXT NOT NULL DEFAULT 'TERMINI' CHECK (scadenza_origine IN ('FILE','TERMINI','PREDEFINITA','MANUALE')),
  importo          NUMERIC(14,2) NOT NULL,            -- totale del documento; negativo = nota di credito
  incassato        NUMERIC(14,2) NOT NULL DEFAULT 0,
  stato            TEXT NOT NULL DEFAULT 'APERTA' CHECK (stato IN ('APERTA','PARZIALE','PAGATA','NOTA_CREDITO','ANNULLATA')),
  chiusa_origine   TEXT,                              -- BANCA | MANUALE | PARTITARIO
  chiusa_at        TIMESTAMPTZ,
  linea            TEXT,
  descrizione      TEXT,
  contestata       BOOLEAN NOT NULL DEFAULT FALSE,    -- una contestazione sospende la scala: gestione eccezioni
  contestazione_nota TEXT, contestata_at TIMESTAMPTZ, contestazione_chiusa_at TIMESTAMPTZ,
  fase             INT NOT NULL DEFAULT 0,            -- ultima fase raggiunta: 0 nessuna, 1 avviso, 2 primo sollecito, 3 secondo, 4 chiamata, 5 legale
  fase_at          TIMESTAMPTZ,
  nota             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (fonte, fonte_id)
);
CREATE INDEX IF NOT EXISTS fatture_org_idx ON fatture (organization_id);
CREATE INDEX IF NOT EXISTS fatture_aperte_idx ON fatture (scadenza) WHERE stato IN ('APERTA','PARZIALE');
CREATE INDEX IF NOT EXISTS fatture_numero_idx ON fatture (numero);
-- Incassi attribuiti alle fatture: dalla banca (proposti o confermati), a mano, dal partitario
CREATE TABLE IF NOT EXISTS incassi (
  id                  SERIAL PRIMARY KEY,
  fattura_id          INT NOT NULL REFERENCES fatture(id) ON DELETE CASCADE,
  importo             NUMERIC(14,2) NOT NULL CHECK (importo > 0),
  data                DATE NOT NULL,
  origine             TEXT NOT NULL CHECK (origine IN ('BANCA','MANUALE','PARTITARIO','NOTA_CREDITO')),
  nota_credito_id     INT,                             -- nota di credito applicata alla fattura (origine NOTA_CREDITO)
  bank_transaction_id BIGINT,
  stato               TEXT NOT NULL DEFAULT 'CONFERMATO' CHECK (stato IN ('PROPOSTO','CONFERMATO','RIFIUTATO')),
  automatico          BOOLEAN NOT NULL DEFAULT FALSE,
  punteggio           INT,
  motivo              TEXT,
  user_id             INT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  confermato_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS incassi_fattura_idx ON incassi (fattura_id);
CREATE INDEX IF NOT EXISTS incassi_mov_idx ON incassi (bank_transaction_id);
-- Esame dei movimenti bancari in entrata: uno stato per movimento
CREATE TABLE IF NOT EXISTS movimenti (
  bank_transaction_id BIGINT PRIMARY KEY,
  stato               TEXT NOT NULL DEFAULT 'DA_ABBINARE' CHECK (stato IN ('DA_ABBINARE','PROPOSTO','ABBINATO','IGNORATO')),
  organization_id     INT,                             -- cliente riconosciuto (dal nome, dall'IBAN o dalla causale)
  riconosciuto_per    TEXT,
  residuo             NUMERIC(14,2),                   -- parte del bonifico non attribuita a fatture
  nota                TEXT,
  user_id             INT,
  esaminato_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comunicazioni (
  id              SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  fase            INT NOT NULL,                        -- 1 avviso, 2 primo sollecito, 3 secondo sollecito, 5 messa in mora
  canale          TEXT NOT NULL DEFAULT 'EMAIL',
  stato           TEXT NOT NULL CHECK (stato IN ('DA_APPROVARE','IN_CODA','INVIATA','REGISTRATA','SIMULATA','FALLITA','ANNULLATA')),
  motivo_attesa   TEXT,                                -- perché non è partita da sola
  destinatari     TEXT, cc TEXT,
  oggetto         TEXT NOT NULL,
  corpo_html      TEXT NOT NULL,
  corpo_testo     TEXT,
  totale          NUMERIC(14,2) NOT NULL DEFAULT 0,
  rif             TEXT NOT NULL UNIQUE,                -- riferimento nell'oggetto [TD-CRED-<rif>]: abbina le risposte
  simulata        BOOLEAN NOT NULL DEFAULT FALSE,      -- modalità Prova: preparata ma non inviata
  automatica      BOOLEAN NOT NULL DEFAULT TRUE,
  creata_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  creata_da       INT,
  approvata_da    INT, approvata_at TIMESTAMPTZ,
  inviata_at      TIMESTAMPTZ,
  errore          TEXT,
  email_log       TEXT,
  pec_stato       TEXT NOT NULL DEFAULT 'NON_PREVISTA' CHECK (pec_stato IN ('NON_PREVISTA','DA_INVIARE','INVIATA')),
  pec_indirizzo   TEXT, pec_at TIMESTAMPTZ, pec_da INT
);
CREATE INDEX IF NOT EXISTS comunicazioni_org_idx ON comunicazioni (organization_id, creata_at DESC);
CREATE INDEX IF NOT EXISTS comunicazioni_stato_idx ON comunicazioni (stato);
CREATE TABLE IF NOT EXISTS comunicazioni_fatture (
  comunicazione_id INT NOT NULL REFERENCES comunicazioni(id) ON DELETE CASCADE,
  fattura_id       INT NOT NULL REFERENCES fatture(id) ON DELETE CASCADE,
  fase             INT NOT NULL,
  residuo          NUMERIC(14,2),
  PRIMARY KEY (comunicazione_id, fattura_id)
);
CREATE INDEX IF NOT EXISTS comunicazioni_fatture_f_idx ON comunicazioni_fatture (fattura_id, fase);
-- Risposte dei clienti lette da amministrazione@ (solo quelle riconducibili a un cliente con una posizione aperta o a un riferimento)
CREATE TABLE IF NOT EXISTS risposte (
  id               SERIAL PRIMARY KEY,
  graph_id         TEXT UNIQUE,
  ricevuta_at      TIMESTAMPTZ NOT NULL,
  da_email         TEXT, da_nome TEXT,
  oggetto          TEXT,
  anteprima        TEXT,
  organization_id  INT,
  comunicazione_id INT,
  abbinata_per     TEXT,                               -- RIFERIMENTO | MITTENTE | DOMINIO
  classe           TEXT NOT NULL DEFAULT 'ALTRO' CHECK (classe IN ('PAGATO','PROMESSA','CONTESTAZIONE','RICHIESTA','FUORI_UFFICIO','ALTRO')),
  confidenza       NUMERIC(4,2),
  classificata_da  TEXT,                               -- AI | REGOLE
  promessa_data    DATE, promessa_importo NUMERIC(14,2),
  sintesi          TEXT,
  effetto          TEXT,                               -- cosa ha fatto la Suite da sola
  allegati         JSONB NOT NULL DEFAULT '[]'::jsonb,
  stato            TEXT NOT NULL DEFAULT 'DA_GESTIRE' CHECK (stato IN ('DA_GESTIRE','GESTITA')),
  gestita_da       INT, gestita_at TIMESTAMPTZ, gestione_nota TEXT
);
CREATE INDEX IF NOT EXISTS risposte_org_idx ON risposte (organization_id, ricevuta_at DESC);
-- Promesse di pagamento e piani di rientro (il piano va approvato dal RAF)
CREATE TABLE IF NOT EXISTS promesse (
  id              SERIAL PRIMARY KEY,
  organization_id INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  data            DATE NOT NULL,                       -- entro quando (per un piano: ultima rata)
  importo         NUMERIC(14,2),
  origine         TEXT NOT NULL CHECK (origine IN ('RISPOSTA','CHIAMATA','MANUALE')),
  risposta_id     INT, chiamata_id INT,
  piano           BOOLEAN NOT NULL DEFAULT FALSE,
  rate            JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ data, importo }]
  stato           TEXT NOT NULL DEFAULT 'APERTA' CHECK (stato IN ('DA_APPROVARE','APERTA','MANTENUTA','NON_RISPETTATA','ANNULLATA')),
  approvata_da    INT, approvata_at TIMESTAMPTZ,
  nota            TEXT,
  user_id         INT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  chiusa_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS promesse_org_idx ON promesse (organization_id);
-- Cose da fare delle persone: chiamata del referente commerciale, pratica legale da autorizzare
CREATE TABLE IF NOT EXISTS attivita (
  id               SERIAL PRIMARY KEY,
  organization_id  INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL DEFAULT 'CHIAMATA' CHECK (tipo IN ('CHIAMATA')),
  sollecitata_at   TIMESTAMPTZ,                        -- ultimo promemoria al referente
  stato            TEXT NOT NULL DEFAULT 'APERTA' CHECK (stato IN ('APERTA','FATTA','ANNULLATA')),
  entro            DATE,
  assegnata_user_id INT,
  fattura_ids      INT[] NOT NULL DEFAULT '{}',
  totale           NUMERIC(14,2),
  simulata         BOOLEAN NOT NULL DEFAULT FALSE,
  creata_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  chiusa_at        TIMESTAMPTZ,
  nota             TEXT
);
CREATE INDEX IF NOT EXISTS attivita_aperte_idx ON attivita (stato, tipo);
CREATE TABLE IF NOT EXISTS chiamate (
  id               SERIAL PRIMARY KEY,
  organization_id  INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  attivita_id      INT,
  data             DATE NOT NULL,
  interlocutore    TEXT,
  esito            TEXT NOT NULL CHECK (esito IN ('PAGAMENTO_PROMESSO','PIANO_RIENTRO','CONTESTAZIONE','NESSUN_RISCONTRO')),
  impegno_data     DATE, impegno_importo NUMERIC(14,2),
  prossima_azione  TEXT,
  nota             TEXT,
  user_id          INT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pratiche_legali (
  id               SERIAL PRIMARY KEY,
  organization_id  INT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  stato            TEXT NOT NULL DEFAULT 'PROPOSTA' CHECK (stato IN ('PROPOSTA','AUTORIZZATA','TRASMESSA','CHIUSA','RESPINTA')),
  motivo           TEXT,                               -- perché è stata proposta
  fattura_ids      INT[] NOT NULL DEFAULT '{}',
  totale           NUMERIC(14,2) NOT NULL DEFAULT 0,
  serve_dir        BOOLEAN NOT NULL DEFAULT FALSE,     -- importo sopra la soglia: serve anche la Direzione
  raf_da           INT, raf_at TIMESTAMPTZ,
  dir_da           INT, dir_at TIMESTAMPTZ,
  simulata         BOOLEAN NOT NULL DEFAULT FALSE,
  trasmessa_at     TIMESTAMPTZ, trasmessa_da INT,
  chiusa_at        TIMESTAMPTZ, esito TEXT,
  nota             TEXT,
  creata_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pratiche_org_idx ON pratiche_legali (organization_id);
-- Registro dei contatti per cliente (l'aging annotato del memo): data, fase, esito, prossima azione
CREATE TABLE IF NOT EXISTS eventi (
  id              BIGSERIAL PRIMARY KEY,
  organization_id INT,
  at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  tipo            TEXT NOT NULL,
  testo           TEXT NOT NULL,
  user_id         INT,
  dati            JSONB
);
CREATE INDEX IF NOT EXISTS eventi_org_idx ON eventi (organization_id, at DESC);
CREATE TABLE IF NOT EXISTS importazioni (
  id         SERIAL PRIMARY KEY,
  filename   TEXT,
  righe      INT, nuove INT, aggiornate INT, chiuse INT, non_abbinate INT,
  completo   BOOLEAN NOT NULL DEFAULT FALSE,
  user_id    INT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS giri (
  id      BIGSERIAL PRIMARY KEY,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  modalita TEXT,
  esito   JSONB
);
CREATE TABLE IF NOT EXISTS audit_log (
  id        BIGSERIAL PRIMARY KEY,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id   INT,
  action    TEXT NOT NULL,
  entity    TEXT,
  entity_id TEXT,
  label     TEXT,
  data      JSONB,
  ip        TEXT
);
