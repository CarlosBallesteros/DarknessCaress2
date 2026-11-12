# Build Order — Phases, Acceptance, Prompts

> The execution roadmap. For each phase: what to build, which docs the agent reads, and the acceptance checklist THE AGENT must satisfy before claiming done. Prompts to paste live in `10-prompts.md`. **Strictly sequential** — every phase builds on its green predecessor; no phase runs parallel to another.
>
> **Global quality gate (ALL phases):** in addition to each phase's checklist, `npm -w server run build` and `npm -w client run build` must both pass before a phase is claimed done. A phase whose artifact does not compile is NOT green, even where the per-phase list doesn't restate it. Rationale: Vitest/esbuild and ESLint do not type-check, so tsc/vite build failures are invisible to lint/test gates — this bit phases 2–3 (22 tsc errors shipped through two "green" phase verifications).

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
[ ] npm -w client run gen:placeholders                           → all asset files per 07 exist (36 theme files: 6 per class; the hero + the 7 universal terrain files are global; fonts are owner-supplied, never generated)
[ ] docker compose up db → database reachable via `docker compose exec db psql -U dc -d darknesscaress -c "\dt"` (Windows-safe: psql runs inside the container, never on the host); server boots, /api/health 200
[ ] .dockerignore exists at repo root with exactly the entries from 01's Dockerfile section (mandated — the composed build depends on it)
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
[ ] lint/format/tests/builds green; commit(s) "feat(phase-2): ...", pushed
```

## Phase 3 — Rules engine (pure `src/game/`)

**Read:** `00`, `08`, `01` (canonical config shape — the `GameEngineConfig` projection mirrors it), `02`.
**Build:** types, reach (BFS + isPathLegal + previewMove), applyMoves (turn bundle atomicity), checkVictory, config projection `GameEngineConfig` from config.json. Zero I/O.
**Acceptance:**

```
[ ] the full 02 test list passes (movement matrix, counter behavior per class distance, damage floor, heal clamp, death, healer cannot attack, atomic bundle, victory, preview consistency, landing-tile rule, strict-sequential resolution, missing-targetId rejection)
[ ] engine module imports NOTHING from features/ (eslint boundary or import check)
[ ] rerun with mutated config numbers in a temp file still passes (proves no hardcoded stats)
[ ] commit "feat(phase-3): ...", pushed
```

## Phase 4 — Board generation

**Read:** `00`, `08`, `03`, `04` (client + mock only).
**Build:** brief prompt + zod brief schema, mock+real client pieces of `LlmClient` (turn() can be a stub until phase 5), materializer with seeded walk, invariants validator, army spawn layout, retry policy incl. fallback template, `POST /api/games` (endpoint 10 of `06`) **async per the v2 amendment**: capability checks (auth + cap) → insert `generating_board` row with all-plain placeholder board + empty units → `202 {"game"}` immediately → board generation runs as a BACKGROUND JOB (fire-and-forget, shared ACTIVE-JOB set guard, stale sweep — the same mechanism phase 5's AI turn job uses) that flips the row to `player_turn` with the real board/armies on success, and on failure writes `ai_last_error` + fresh `updated_at` and stays `generating_board` (retried forever by the sweep — no client error state), `used_fallback` recorded in the row when the fallback template fires.
**Acceptance:**

```
[ ] invariants property tests pass for ≥ 40 seeds (river simple path left edge → right edge, bridges on river, crossability)
[ ] riverless-brief test passes (river: null ⇒ zero water beyond the lake, crossability holds, invariants 1–3 skipped)
[ ] retry budget comes from config: `config.ai.boardRetries` honored (a temp config with `materializations: 1` stops after one attempt → regenerates → fallback; proves no hardcoded budget)
[ ] determinism test: same brief+seed = byte-identical board
[ ] fallback template validates
[ ] mock-LLM full flow: POST /api/games → 202 GameState (status generating_board, placeholder board, empty units) → background job designs the board → GET shows status player_turn, armies placed per 03's spawn scatter layout
[ ] 409 on 6th active game (cap from config; a generating_board game COUNTS as active — non-lost counting per 06)
[ ] commit "feat(phase-4): ...", pushed
```

## Phase 5 — AI turns & remaining API

**Read:** `00`, `08`, `02`, `04`, `06` (endpoints 9, 11–15, 8).
**Build:** server-side enemy move policies (menu-choice over engine-generated options per difficulty), destination-only expansion + engine application, background AI-turn job + fire-and-forget + stale recovery (endpoints 9/11 side effects), moves/end-turn/preview/forfeit/stats endpoints. Board briefs remain the LLM seam (MockLlm for tests).
**Acceptance:**

```
[ ] server-side move loop: create → POST moves (valid bundle) → end-turn → policy job applies enemy moves → status flips player_turn (or lost), turn advances, lastAiActions populated, ai_last_error cleared
[ ] policy legality/intent: aggressive/defensive/erratic produce only engine-legal, menu-valid bundles (no conflicts, no out-of-menu attacks); personas behave per 04
[ ] illegal player bundle → 400 with exact message, DB row untouched (atomicity via transaction), the errored move's index exposed in "move N:" prefix; FAILED attempts leave the round unlocked (re-submission allowed); a SECOND applied submission in one round → 409 "Turn moves already submitted"; the lock is `games.moves_applied` — RESTART-PROOF
[ ] EVOLVING landing validation: chain-follow SUCCESSES, must-fail cases still reject, and swap-by-order works
[ ] stats endpoint matches seeded outcomes
[ ] AI orders are DESTINATION-ONLY (`to`, expanded server-side via docs/02 `pathTo`) and always derived from engine-generated menus; PLAYER contract (endpoint 13) still requires full paths (unchanged)
[ ] server-side interval sweep (`01`): with the interval configured, a stale job resumes WITHOUT any client GET; the ACTIVE-JOB guard prevents double-launch when GET and interval fire together
[ ] conditional persist: a forfeit during the AI job discards the result (lost stands)
[ ] contract conformance: full table of 06 verified by tests (paths/statuses/bodies)
[ ] commit "feat(phase-5): ...", pushed
```

## Phase 6 — Frontend (whole website)

**Read:** `00`, `08`, `05`, `07`, `06` (backend already built against the same contract).
**Build:** all routes/components per `05`, api client + DTO types, polling hook, staged-move reducer, overlays, meta-driven Champions/Profile/Stats (the landing page's hero is a UNIVERSAL asset — no meta consumption needed there), placeholder lore DRAFTED: agent drafts the 6 lore strings (class-level, no names, war-warm poetic, 2–3 sentences each) into config.json — owner will rewrite. **Phase 6's ONLY permitted server/ touches (both are data/config, never server logic): (a) the lore strings in `server/src/config/config.json`, and (b) the production static-serving middleware in `server/src/app.ts` per `01`'s file description — owner-ratified in v1, and REQUIRED for this phase's E2E successor (the composed stack must serve the built SPA).**
Also: Vite dev proxy to server; production static serving works via express.static.
**Acceptance:**

```
[ ] Vitest suites green (api wrapper, usePolling, reducer, path-display helper)
[ ] manual-vs-code review: every data-testid from 05 present; lint/format/tests/builds green
[ ] dev flow works: register → login → land on /play (verified manually; Playwright covers it fully in phase 7)
[ ] commit "feat(phase-6): ...", pushed
```

## Phase 7 — E2E + deployment

**Read:** `00`, `08`, `01` (compose/deploy), `06`, `05` (testids), `04` (mock mode).
**Build:** Playwright suite against the fully composed stack (`docker compose up`, server with `LLM_MOCK=1` for deterministic E2E — real-Ollama runs are manual owner checks). Deploy runbook below.
**Acceptance:**

```
[ ] e2e/playwright: register flow, login (bad + good), create game (202 → "Being designed…" card/board state → resolves to player_turn), select unit, preview overlay, stage a move, end turn, mocked AI turn resolves + board updates, stats reflect win/loss, forfeit path, Store tab renders "Coming soon…", logout/login
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

## Phase 8 — Code refactor (behavior-preserving)

**Read:** `00`, `01`, `02`, `03`, `04`, `06`, `08`, `09`, `11-phase-8-code-refactor.md`.
**Build:** Stabilize and refactor server/client code without changing rules, contracts, or user-visible behavior: resolve remaining 8×8-migration test fallout to get suites green, then apply focused maintainability refactors in hotspots (board/spawn/invariants, AI/games/jobs, board UI state/helpers) while preserving boundaries and determinism. See `11-phase-8-code-refactor.md` for scope, constraints, risks, and execution breakdown.
**Acceptance:**

```
[ ] npm -w server run lint && npm -w client run lint            → 0 errors
[ ] npx prettier --check .                                       → clean
[ ] npm -w server test && npm -w client test                     → all green
[ ] npm -w server run build && npm -w client run build           → clean
[ ] No API/rule/config-semantics changes; 8×8 full-width spawn and AI/turn/job behavior preserved
[ ] server/src/game/ remains pure (no feature/db/http imports)
[ ] commit(s) "refactor(phase-8): ..." / "test(phase-8): ..." as appropriate, pushed
```

## Phase 9 — UI refactor (professional & responsive)

**Read:** `00`, `01`, `05`, `06`, `07`, `08`, `09`, `12-phase-9-ui-refactor.md`.
**Build:** Refactor the frontend presentation for a professional, consistent, and responsive experience across routes (shell/nav, games strip, board screen, stats/champions/profile/store/auth/landing), consolidating tokens/styles and improving interaction affordances/accessibility basics — without changing gameplay behavior, routes, API usage, or contracts. See `12-phase-9-ui-refactor.md` for scope, constraints, risks, and execution breakdown.
**Acceptance:**

```
[ ] npm -w client run lint && npm -w client run build           → clean
[ ] npm -w client test                                           → green
[ ] npm -w server run lint && npm -w server run build            → still clean
[ ] Responsive/layout checks pass for key screens (~360px, tablet, desktop); light/dark modes consistent
[ ] Board/strip interactions, overlays, enemy inspect, staging/end-turn/AI states behave per 05/06
[ ] No data-testid renames/removals and no API/gameplay behavior changes
[ ] commit(s) "refactor(phase-9): ..." / "style(phase-9): ..." as appropriate, pushed
```
