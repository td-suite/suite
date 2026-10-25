-- Suite TD · Community: bacheca, news e circolari, avvisi, calendario, frase del giorno
-- audience: {"type":"ALL"} | {"type":"INTERNAL"} | {"type":"SITES","ids":[1,2]} | {"type":"ORGS","ids":[3]} | {"type":"MODULE","key":"cash"} | {"type":"USERS","ids":[..]}

CREATE TABLE posts (
  id          SERIAL PRIMARY KEY,
  author_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT NOT NULL,
  audience    JSONB NOT NULL DEFAULT '{"type":"ALL"}'::jsonb,
  site_id     INT REFERENCES sites(id) ON DELETE SET NULL,     -- gruppo di sede (facoltativo)
  pinned      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at  TIMESTAMPTZ
);
CREATE INDEX posts_feed_idx ON posts (deleted_at, pinned DESC, created_at DESC);
CREATE TABLE post_files (
  post_id INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  file_id INT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, file_id)
);
CREATE TABLE post_reactions (
  post_id INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL DEFAULT 'LIKE' CHECK (kind IN ('LIKE','CLAP','HEART','IDEA')),
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE TABLE post_comments (
  id         SERIAL PRIMARY KEY,
  post_id    INT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX post_comments_idx ON post_comments (post_id, created_at);

-- News aziendali, circolari interne (con presa visione), articoli del blog (pubblicabili all'esterno)
CREATE TABLE news (
  id            SERIAL PRIMARY KEY,
  kind          TEXT NOT NULL DEFAULT 'NEWS' CHECK (kind IN ('NEWS','CIRCOLARE','BLOG')),
  title         TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  summary       TEXT,
  body          TEXT NOT NULL,                                -- markdown
  cover_file_id INT REFERENCES files(id) ON DELETE SET NULL,
  author_id     INT REFERENCES users(id) ON DELETE SET NULL,
  audience      JSONB NOT NULL DEFAULT '{"type":"ALL"}'::jsonb,
  status        TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  published_at  TIMESTAMPTZ,
  requires_ack  BOOLEAN NOT NULL DEFAULT FALSE,               -- circolari: presa visione obbligatoria
  ack_due       DATE,
  protocol      TEXT,                                         -- es. CIRC-2026-012
  is_public     BOOLEAN NOT NULL DEFAULT FALSE,               -- visibile sulle vetrine pubbliche (blog)
  tags          TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX news_pub_idx ON news (status, kind, published_at DESC);
CREATE TABLE news_files (
  news_id INT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  file_id INT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  PRIMARY KEY (news_id, file_id)
);
CREATE TABLE news_acks (
  news_id INT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (news_id, user_id)
);

-- Avvisi (banner a tempo)
CREATE TABLE notices (
  id         SERIAL PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT,
  severity   TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO','WARN','CRIT')),
  audience   JSONB NOT NULL DEFAULT '{"type":"ALL"}'::jsonb,
  link       TEXT,
  starts_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at    TIMESTAMPTZ,
  author_id  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Calendario: eventi interni, formazione, scadenze, turni (da Room), riunioni (da M365)
CREATE TABLE events (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  description TEXT,
  kind        TEXT NOT NULL DEFAULT 'EVENTO' CHECK (kind IN ('EVENTO','RIUNIONE','FORMAZIONE','SCADENZA','TURNO','FESTIVITA','ALTRO')),
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ,
  all_day     BOOLEAN NOT NULL DEFAULT FALSE,
  location    TEXT,
  site_id     INT REFERENCES sites(id) ON DELETE SET NULL,
  audience    JSONB NOT NULL DEFAULT '{"type":"ALL"}'::jsonb,
  source      TEXT NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','M365','ROOM','CONTRACTS','SYSTEM')),
  external_id TEXT,
  link        TEXT,
  author_id   INT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, external_id)
);
CREATE INDEX events_time_idx ON events (starts_at);

-- Frase del giorno: generata da Claude sui valori aziendali, approvata dalla Comunicazione, mai pubblicata senza approvazione
CREATE TABLE quotes (
  id           SERIAL PRIMARY KEY,
  text         TEXT NOT NULL,
  author_label TEXT,                           -- es. "Valori Toscana Diagnostica · Cura del tempo"
  theme        TEXT,
  status       TEXT NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED','APPROVED','REJECTED','PUBLISHED')),
  for_date     DATE UNIQUE,                    -- assegnata al momento della pubblicazione
  created_by   INT REFERENCES users(id) ON DELETE SET NULL,
  approved_by  INT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Risposte della ricerca con Claude (per trasparenza e controllo dei costi)
CREATE TABLE ai_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id    INT REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,                    -- search | quote | summary
  model      TEXT,
  tokens_in  INT, tokens_out INT,
  query      TEXT,
  ok         BOOLEAN NOT NULL DEFAULT TRUE,
  error      TEXT
);
