# Architecture & Stack

> Concrete decisions only. Versions and libraries below are frozen (see `08-agent-rules.md` rule 6).

## Stack

| Layer | Choice |
|---|---|
| Frontend | React 18 + Vite + TypeScript (strict), React Router 6, plain CSS (no Tailwind), `fetch` + `setInterval` (no data-fetching library) |
| Backend | Node 22 (LTS, alpine), **Express 4**, TypeScript (strict), `cookie-parser`, `jsonwebtoken`, `bcrypt`, `pg` (node-postgres), `zod`, `express-rate-limit` |
| Database | PostgreSQL 16 (alpine), plain SQL migrations, no ORM |
| AI | Ollama (`ollama/ollama` image), model `qwen2.5:7b-instruct-q4_K_M` via `OLLAMA_MODEL` env |
| Tests | Vitest (unit, both sides), Playwright (E2E, top-level `/e2e`) |
| Quality | ESLint 9 (flat config) + Prettier |
| Deploy | docker-compose, 3 services, single VM (Oracle Always Free ARM, aarch64) — deploys on ANY Docker host; the free-tier A1 shape (1 OCPU / 6 GB) runs the full MVP (4/24 is optional growth, see `00` later hooks) |

Why plain SQL and no ORM: the schema is 2 tables. Every query lives in one small module per feature and is reviewed at a glance. Why `zod`: one schema-definition library for API input validation AND LLM response validation — reused everywhere, nothing else.

## Monorepo layout (exact)

```
DarknessCaress2/
├── package.json                  # npm workspaces: ["client", "server"] (+ shared scripts)
├── docs/                        # this doc set
├── client/                      # React SPA ("the website")
│   ├── src/
│   │   ├── main.tsx             # router + entry
│   │   ├── api/                 # one thin fetch wrapper per API group (auth.ts, games.ts, meta.ts)
│   │   ├── routes/
│   │   │   ├── Landing.tsx
│   │   │   ├── Login.tsx
│   │   │   ├── Register.tsx
│   │   │   ├── GameStrip.tsx     # "Game" tab home: scroll-snap strip (creation order) + New battle tile
│   │   │   ├── GameBoard.tsx     # the board UI
│   │   │   ├── Statistics.tsx
│   │   │   ├── Champions.tsx
│   │   │   └── Profile.tsx
│   │   ├── components/          # Board, Unit, TopMenu, ProtectedRoute, ...
│   │   ├── styles/              # tokens.css + one file per route
│   │   ├── scripts/             # gen-placeholders.mjs (07) — placeholder asset generator
│   │   └── types/               # API DTO types (mirrors 06)
│   ├── public/assets/           # asset convention (see 07) — placeholder art ships here
│   ├── index.html
│   └── vite.config.ts           # dev proxy /api → server
├── server/
│   ├── src/
│   │   ├── app.ts               # express app + static serving of ../client/dist in production
│   │   ├── config/
│   │   │   └── config.json      # THE single config file (schema below)
│   │   ├── db/
│   │   │   ├── pool.ts          # pg Pool
│   │   │   ├── migrate.ts       # runs schema.sql idempotently
│   │   │   └── schema.sql
│   │   ├── features/
│   │   │   ├── auth/            # register, login, logout, me, password (routes + auth middleware)
│   │   │   ├── users/           # profile updates
│   │   │   ├── games/           # CRUD, moves, end-turn, list, forfeit
│   │   │   ├── ai/              # llm client, turn job, validation loop (see 04)
│   │   │   ├── board/           # brief → materialization → invariants (see 03)
│   │   │   └── stats/           # read-only aggregates
│   │   ├── game/                # PURE rules engine, zero I/O (see 02): types, reach, combat, validate
│   │   └── env.ts               # zod-validated env vars
│   └── package.json
├── e2e/                         # Playwright specs (see 09 phase 7)
├── docker-compose.yml
├── .env.example
└── .gitignore
```

Rules of the layout: `server/src/game/` (the shorthand `src/game/` in other docs means the same path) is pure and imports nothing from features; features import from `src/game/`; nothing imports upward. The AI client lives only in `features/ai/`.

## Database schema (`server/src/db/schema.sql` — exact)

```sql
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
  board       JSONB NOT NULL,            -- {tiles: string[15][15]} codes from 02
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
```

No move-history table in MVP (stats are computed from `games`). Replay/audit is a later hook.

## Config file — canonical shape (`server/src/config/config.json`)

```json
{
  "boardSize": 15,
  "maxActiveGames": 5,
  "classes": {
    "sword":  { "count": 2, "hp": 20, "atk": 7,  "def": 5, "mov": 3, "range": [1],    "role": "attacker",  "label": "Swordsman" },
    "axe":    { "count": 2, "hp": 25, "atk": 10, "def": 3, "mov": 2, "range": [1],    "role": "attacker",  "label": "Axeman" },
    "spear":  { "count": 2, "hp": 18, "atk": 6,  "def": 3, "mov": 5, "range": [1],    "role": "attacker",  "label": "Spearman" },
    "archer": { "count": 2, "hp": 16, "atk": 6,  "def": 2, "mov": 4, "range": [2],    "role": "supporter", "label": "Archer" },
    "mage":   { "count": 1, "hp": 15, "atk": 8,  "def": 1, "mov": 3, "range": [1,2,3],"role": "supporter", "label": "Mage" },
    "healer": { "count": 1, "hp": 18, "atk": 0,  "def": 2, "mov": 2, "range": [],     "healAmount": 8, "role": "supporter", "label": "Healer" }
  },
  "personalities": {
    "aggressive": { "label": "Aggressive", "temperature": 0.7 },
    "defensive":  { "label": "Defensive",  "temperature": 0.4 },
    "erratic":    { "label": "Erratic",    "temperature": 1.2 }
  },
  "themes": [
    { "id": "warriors-europe", "label": "Champions of Europe" }
  ],
  "lore": { "sword": "…", "axe": "…", "spear": "…", "archer": "…", "mage": "…", "healer": "…" },
  "ai": { "moveRetries": 3, "staleAfterSeconds": 60, "briefTemperature": 0.8,
          "boardRetries": { "materializations": 3, "briefs": 3 } }
}
```

The server loads it once and serves the public subset via `GET /api/meta` — an **unauthenticated** endpoint (the landing page needs the default theme; the game data revealed there is harmless). The served subset: `boardSize`, `maxActiveGames`, `classes` (labels/stats/role/count), `personalities` labels, `themes`, `lore`. The frontend never reads the FILE — it consumes the served subset only. (This list matches `06`'s meta example field-for-field.)

## Runtime model

- **One Express process does everything**: API + AI job runner + serving the built SPA via `express.static` in production. Same origin in production ⇒ **no CORS code at all**; in dev, Vite proxies `/api` to the server (no CORS either).
- **AI turn job:** when `POST /api/games/:id/end-turn` flips a game to `ai_turn`, the route kicks off `runAiTurn(gameId)` **without awaiting** it (fire-and-forget with an appended `"unhandled"` safe catch that logs). The job: load state → call LLM per `04-ai-integration.md` → validate + apply moves with the pure engine → **persist conditionally**: `UPDATE … WHERE status = 'ai_turn'` — if the game left `ai_turn` meanwhile (a forfeit during the AI's thinking), the job's result is DISCARDED and the forfeit's `lost` stands; only then update the row (`player_turn` | `lost` — never `won`: `06`'s status matrix has no `ai_turn → won`; clears `ai_last_error`). On failure: writes `ai_last_error`, sets `updated_at = now()` (fresh sweep timer — prevents rapid hammering), leaves `ai_turn` — `turn_number` stays UNCHANGED on failure (consistent with `04`; it advances only on a successful AI turn).
- **Background jobs (two kinds, one mechanism):** the AI turn job above, and the **board-design job** (POST /api/games inserts `generating_board` + placeholder board, then runs `generateBoard` fire-and-forget the same way; on success the row flips to `player_turn` with the real board/armies per `03`; on failure it writes `ai_last_error`, refreshes `updated_at`, and stays `generating_board` — retried forever by the sweep, never surfaced as a client error, per `06` ep. 10). Both share the ACTIVE-JOB set guard and stale sweep below.
- **Stale recovery** (the only keeper): any `GET` of a game or the games list first re-triggers jobs for that user's games where `(status = 'ai_turn' OR status = 'generating_board') AND now() - updated_at > config.ai.staleAfterSeconds`. Idempotency guard (race-proof): in-process `Map<gameId, startedAt>` acting as an **ACTIVE-JOB set — an entry is added synchronously (check-and-set in the same tick, before any await) and REMOVED only when the job completes (success or failure)**; a sweep skips any game with an active entry. No time window: however long the LLM takes (retries can stretch a job past a minute), a running job is never double-launched. Server restart empties the map — which is precisely when self-heal is wanted.
- **Row→DTO mapping:** DB columns are snake_case (`turn_number`, `updated_at`, `ai_last_error`); public DTOs are camelCase (`turnNumber`, `updatedAt`). One small mapping function per feature converts rows to `06`'s DTOs — no ORM magic, no ad-hoc renames sprinkled around.
- **No queues, no websockets, no cron.** Polling every 3 s from the client on list/board views while any of the user's games is `ai_turn` OR `generating_board` (`05`).

## Environment variables (`.env.example` — exact)

```
DATABASE_URL=postgres://dc:dc@db:5432/darknesscaress
JWT_SECRET=change-me-64-characters
OLLAMA_URL=http://ollama:11434
OLLAMA_MODEL=qwen2.5:7b-instruct-q4_K_M
# LLM_MOCK=1                      # OPTIONAL, local dev only: selects the fixture AI client
                                  # instead of Ollama (04). Tests set it automatically.
                                  # NEVER set it on the deployed VM. In prod it's real.
PORT=3000
NODE_ENV=production
```

`env.ts` validates these with zod once at boot and exits loudly if missing. Secrets never enter git; `.env` is gitignored.

## docker-compose (exact file, final)

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: dc
      POSTGRES_PASSWORD: dc
      POSTGRES_DB: darknesscaress
    volumes: [db_data:/var/lib/postgresql/data]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U dc"], interval: 5s, retries: 10 }

  ollama:
    image: ollama/ollama
    volumes: [ollama_data:/root/.ollama]
    environment:
      OLLAMA_KEEP_ALIVE: 1h        # keep the model in RAM between player turns
    restart: unless-stopped

  server:
    build: { context: ., dockerfile: server/Dockerfile }
    depends_on:
      db: { condition: service_healthy }
    env_file: .env
    ports: ["80:3000"]
    restart: unless-stopped

volumes: { db_data: {}, ollama_data: {} }
```

> **Dev-only override (committed):** `docker-compose.override.yml` binds the db to `127.0.0.1:5432` so host-run tests/dev reach it (the README quickstart depends on it). In production the override merely allocates the port on VM-localhost — deploy behavior is unchanged. `.env.example` keeps the docker-DNS host (`db:5432`) for container-side use; local `.env` uses the loopback host.

`server/Dockerfile` (multi-stage, exact):

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci
COPY . .
RUN npm -w client run build
RUN npm -w server run build

FROM node:22-alpine
WORKDIR /app/server
COPY --from=build /app/server /app/server
COPY --from=build /app/client/dist /app/client/dist
# Workspace deps are COMMITTED and HOISTED to /app/node_modules by root `npm ci`
# (npm workspaces hoist by design) - the final stage must ship them so the server
# resolves `pg` and every dependency: node resolves /app/server/dist/... imports
# by walking UP to /app/node_modules.
COPY --from=build /app/node_modules /app/node_modules
EXPOSE 3000
CMD ["node", "dist/app.js"]
```

**One-time model download** (first deploy only, on the VM): `docker compose exec ollama ollama pull $OLLAMA_MODEL` — stored in the `ollama_data` volume, survives restarts. The server tolerates Ollama being warm/cold (its retry/stale-recovery handles both).

## Auth mechanics

- Passwords: `bcrypt`, cost 10 (fits the ARM VM).
- Session: JWT (sub = user id, exp 7d), signed with `JWT_SECRET`, delivered as httpOnly, SameSite=Lax cookie `dc_session`. Login/register set the cookie; a shared `requireAuth` middleware reads+verifies it and attaches the user.
- Login rate limit: `express-rate-limit` (in-memory) applied to `/api/auth/login`: max 10 requests/min/IP.
- Registration constraints (zod): email format, password min 8 chars, username 3–20 chars `[a-zA-Z0-9_-]`, all unique (per schema).
