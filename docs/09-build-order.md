# Build Order — Phases, Acceptance, Prompts

> The execution roadmap. For each phase: what to build, which docs the agent reads, and the acceptance checklist THE AGENT must satisfy before claiming done. Prompts to paste live in `10-prompts.md`. **Strictly sequential** — every phase builds on its green predecessor; no phase runs parallel to another.

## Phase 0 — Prerequisites (owner, human)

- Git remote: `github.com/CarlosBallesteros/DarknessCaress2` (exists, empty).
- Local clone, Node 22 LTS + Docker Desktop installed, `gh` CLI authed (or provide your git credentials flow).
- GitHub repo access from the agent's machine. Docs are committed first (already in `docs/`).

## Phase 1 — Scaffold & quality gates

**Read:** `00`, `08`, `01`, `07`.
**Build:** exact monorepo skeleton of `01` (client, server, e2e, docker-compose, .env.example), TS strict, ESLint9+Prettier, Vitest scaffolding (both packages), Playwright config in `/e2e`, `server` boots with `GET /api/health` → `{"ok":true}` (no auth), placeholder-asset generator script runs, config.json loads honoring the `01` shape with the `00` stat values and lore as simple placeholders (lore will be drafted in phase 6), plus the tiny `wrapAsync` helper for Express routes (made real here so every later phase inherits it).
**Acceptance:**

```
[ ] npm -w server run lint && npm -w client run lint            → 0 errors
[ ] npx prettier --check .                                       → clean
[ ] npm -w server test && npm -w client test                     → pass (≥ placeholder health test)
[ ] npm -w client run gen:placeholders                           → all asset files per 07 exist (4 per class + hero; baseline config ⇒ 25)
[ ] docker compose up db → psql \dt shows empty schema; server boots, /api/health 200
[ ] commits formatted "chore(phase-1): ..." (multiple allowed), pushed
```

## Phase 2 — Auth & users

**Read:** `00`, `08`, `01`, `06` (endpoints 1–7: auth, users, meta; stats comes in phase 5).
**Build:** users table + migrations runner (`schema.sql` idempotent), register/login/logout/me/patch-me/password, bcrypt cost 10, JWT cookie, `express-rate-limit` on login, zod input schemas, `requireAuth` middleware — all routes wrapped in phase 1's `wrapAsync` helper (no unhandled rejections, ever).
**Acceptance:**

```
[ ] unit tests: password hashing, register dup (email/username 409), login wrong-password 401 same message, JWT verify/expire, requireAuth 401
[ ] supertest-based endpoint tests: register→login→me→patch username→password change→logout round trip, all statuses per contract (incl. 400s)
[ ] rate limit fires 429 on 11th rapid login attempt
[ ] contract deviates NOWHERE from 06 (paths, status, message strings)
[ ] lint/format/tests green; commit(s) "feat(phase-2): ...", pushed
```

## Phase 3 — Rules engine (pure `src/game/`)

**Read:** `00`, `08`, `02`.
**Build:** types, reach (BFS + isPathLegal + previewMove), applyMoves (turn bundle atomicity), checkVictory, config projection `GameEngineConfig` from config.json. Zero I/O.
**Acceptance:**

```
[ ] the full 02 test list passes (movement matrix, counter behavior per class distance, damage floor, heal clamp, death, healer cannot attack, atomic bundle, victory, preview consistency)
[ ] engine module imports NOTHING from features/ (eslint boundary or import check)
[ ] rerun with mutated config numbers in a temp file still passes (proves no hardcoded stats)
[ ] commit "feat(phase-3): ...", pushed
```

## Phase 4 — Board generation

**Read:** `00`, `08`, `03`, `04` (client + mock only).
**Build:** brief prompt + zod brief schema, mock+real client pieces of `LlmClient` (turn() can be a stub until phase 5), materializer with seeded walk, invariants validator, army spawn layout, retry policy incl. fallback template, `POST /api/games` (endpoint 10 of `06`) works fully (auth + cap + insertion).
**Acceptance:**

```
[ ] invariants property tests pass for ≥ 40 seeds (river simple path left edge → right edge, bridges on river, crossability)
[ ] determinism test: same brief+seed = byte-identical board
[ ] fallback template validates
[ ] mock-LLM full flow: POST /api/games → 201 GameState with armies placed per 03's spawn scatter layout
[ ] 409 on 6th active game (cap from config)
[ ] commit "feat(phase-4): ...", pushed
```

## Phase 5 — AI turns & remaining API

**Read:** `00`, `08`, `02`, `04`, `06` (endpoints 9, 11–15, 8).
**Build:** serializer, persona system prompts, turn validation loop with bounded retries + `ai_last_error`, background job + fire-and-forget + stale recovery (endpoints 9/11 side effects), moves/end-turn/preview/forfeit/stats endpoints. Unit tests use MockLlm fixtures.
**Acceptance:**

```
[ ] mock-LLM full loop: create → POST moves (valid bundle per fixtures) → end-turn → job applies enemy moves → status flips player_turn, lastAiActions populated
[ ] retry loop verified against fixtures (malformed JSON, illegal move, feedback message contains engine text)
[ ] exhaustion path: 3 failures → ai_last_error set, status stays ai_turn, stale recovery re-triggers (simulated stale timestamps) — no heuristic ever moves enemy units
[ ] illegal player bundle → 400 with exact message, DB row untouched (atomicity via transaction)
[ ] stats endpoint matches seeded outcomes
[ ] contract conformance: full table of 06 verified by tests (paths/statuses/bodies)
[ ] commit "feat(phase-5): ...", pushed
```

## Phase 6 — Frontend (whole website)

**Read:** `00`, `08`, `05`, `07`, `06` (backend already built against the same contract).
**Build:** all routes/components per `05`, api client + DTO types, polling hook, staged-move reducer, overlays, meta-driven Champions/Profile/Stats, placeholder lore DRAFTED: agent drafts the 6 lore strings (class-level, no names, war-warm poetic, 2–3 sentences each) into config.json — owner will rewrite.
Also: Vite dev proxy to server; production static serving works via express.static.
**Acceptance:**

```
[ ] Vitest suites green (api wrapper, usePolling, reducer, path-display helper)
[ ] manual-vs-code review: every data-testid from 05 present; lint/format/tests green
[ ] dev flow works: register → login → land on /play (verified manually; Playwright covers it fully in phase 7)
[ ] commit "feat(phase-6): ...", pushed
```

## Phase 7 — E2E + deployment

**Read:** `00`, `08`, `01` (compose/deploy), `06`, `05` (testids), `04` (mock mode).
**Build:** Playwright suite against the fully composed stack (`docker compose up`, server with `LLM_MOCK=1` for deterministic E2E — real-Ollama runs are manual owner checks). Deploy runbook below.
**Acceptance:**

```
[ ] e2e/playwright: register flow, login (bad + good), create game, select unit, preview overlay, stage a move, end turn, mocked AI turn resolves + board updates, stats reflect win/loss, forfeit path, logout/login
[ ] full quality gate: lint + prettier + vitest + playwright all green
[ ] deployed on the VM: docker compose up -d; model pulled into ollama volume via 01's one-time command
[ ] public URL serves landing → register → play a REAL AI turn (Ollama live, persona erratic) — owner-verified
[ ] final commit "chore(phase-7): ..." pushed; repo main branch = working deployed state
```

**Deploy runbook (Oracle ARM, exact steps for phase 7):**

```
ssh into VM (Ubuntu aarch64) → install docker + compose plugin
git clone the repo → cp .env.example .env (set unique JWT_SECRET, keep DATABASE_URL db host)
docker compose up -d db && docker compose run --rm server npm run migrate
docker compose up -d && docker compose exec ollama ollama pull $OLLAMA_MODEL
open http://<VM-IP> — verify phases: health, register, play one turn
```
