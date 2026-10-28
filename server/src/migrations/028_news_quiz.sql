-- Questionario di comprensione delle circolari (richiesta del CEO, 28/10/2026): alla pubblicazione di una circolare Claude genera
-- tre domande a risposta multipla dal testo; chi legge risponde nella pagina della circolare prima della presa visione; gli esiti
-- (per persona e per domanda) li vede solo chi gestisce il widget Comunicazione. Le risposte corrette non escono dalle API lettori
-- finché l'utente non ha risposto.
CREATE TABLE IF NOT EXISTS news_quiz (
  news_id     INT PRIMARY KEY REFERENCES news(id) ON DELETE CASCADE,
  questions   JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ "q": "...", "options": ["...","...","...","..."], "answer": 0 }]
  model       TEXT,
  created_by  INT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS news_quiz_answers (
  news_id   INT NOT NULL REFERENCES news(id) ON DELETE CASCADE,
  user_id   INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers   JSONB NOT NULL DEFAULT '[]'::jsonb,     -- indice scelto per ogni domanda
  score     INT NOT NULL DEFAULT 0,
  total     INT NOT NULL DEFAULT 0,
  at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (news_id, user_id)
);
