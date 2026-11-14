CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,
  username      CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  theme         TEXT NOT NULL DEFAULT 'warriors-europe',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS games (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  difficulty  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'generating_board',
  board       JSONB NOT NULL,
  units       JSONB NOT NULL,
  turn_number INT NOT NULL DEFAULT 1,
  ai_last_error TEXT,
  used_fallback BOOLEAN NOT NULL DEFAULT false,
  moves_applied BOOLEAN NOT NULL DEFAULT false,
  last_ai_actions JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id);
