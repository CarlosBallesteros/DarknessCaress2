CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         CITEXT UNIQUE NOT NULL,
  username      CITEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  theme         TEXT NOT NULL DEFAULT 'warriors-europe',  -- baseline = config.themes[0].id; keep in sync when themes change
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS games (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  difficulty  TEXT NOT NULL,             -- persona id from config
  status      TEXT NOT NULL DEFAULT 'generating_board',
              -- generating_board | player_turn | ai_turn | won | lost
              -- (created as generating_board with an all-plain placeholder board and
              -- empty units; the background job fills the real battlefield in — 06 ep. 10)
  board       JSONB NOT NULL,            -- {tiles: string[boardSize][boardSize]} codes from 02 (8x8 baseline)
  units       JSONB NOT NULL,            -- array of units (shape in 02)
  turn_number INT NOT NULL DEFAULT 1,
  ai_last_error TEXT,                    -- set when a background job (AI turn OR board design) fails, cleared on success
  used_fallback BOOLEAN NOT NULL DEFAULT false,  -- true when board generation used the fallback template (debug; not exposed via DTO)
  moves_applied BOOLEAN NOT NULL DEFAULT false,  -- true once a /moves bundle was applied THIS round (incl. empty); reset to false at /end-turn with the acted stroke — the once-per-round lock (`06` ep. 13); not exposed via DTO
  last_ai_actions JSONB,                 -- the AiAction[] of the last applied AI turn (null until the first AI turn)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id);
