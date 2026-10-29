-- Commenti sotto gli articoli del Blog (richiesta del CEO, 29/10/2026: "In BLOG, permetti il commento sotto all'articolo. NON sulla news. Solo sul BLOG").
-- Il vincolo sul kind=BLOG è applicato dalle route (la tabella news non ha il kind come chiave).
CREATE TABLE IF NOT EXISTS news_comments (
  id         SERIAL PRIMARY KEY,
  news_id    INT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  author_id  INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS news_comments_idx ON news_comments (news_id, created_at);
