# E2E — Playwright suite (Phase 7, local portion)

Drives the REAL composed production stack (`docker compose build` + `up`): the
production image that serves the compiled SPA on express.static from the server
container, with `LLM_MOCK=1` pinned to the server env so AI turns resolve
deterministically per `docs/04` standalone mode. The compose lifecycle is
automated by Playwright's `globalSetup`/`globalTeardown`.

## Windows setup (once)

1. Node 22+ and Docker Desktop running (`docker ps` must work).
2. From the repo root, install dependencies (already the workspace root):
   `npm install -ws`
3. Install the Playwright browser:
   `npx playwright install chromium`

## Run

```bash
npm run e2e
```

One command: build → compose up (db → migrate → server+ollama) → health check →
all specs → `docker compose down` (**non-destructive**: named volumes stay).

Useful knobs:

| Variable | Default | Purpose |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:3000` | Local host port of the driven stack (the suite pins the server to loopback :3000; the deploy :80 mapping is untouched) |
| `E2E_KEEP_STACK=1` | unset | Skip teardown, leave the stack running after the run |

## Layout

| File | Purpose |
|---|---|
| `playwright.config.ts` | Suite config (single worker, sequential order) |
| `global-setup.ts` / `global-teardown.ts` | Compose lifecycle (build/up/migrate/health − down) |
| `docker-compose.e2e.yml` | Suite-only merge override: host-port remap (`!override`) + server env (`DATABASE_URL` docker host, `LLM_MOCK=1`) |
| `helpers/stack.ts` | Compose runners + health wait |
| `helpers/api.ts` | Typed request wrappers over `docs/06` endpoints (test-local DTO mirrors) |
| `helpers/play-bot.ts` | Plays a game to victory via endpoints 12/13/14 (see file header for the why) |
| `helpers/session.ts` | Unique per-test users, UI register/login |
| `specs/auth.spec.ts` | register, login (bad + good), logout/login |
| `specs/game-flow.spec.ts` | create game, select unit, preview overlay, stage a move, submit, end turn, mocked AI turn resolves + board updates |
| `specs/win-loss-stats.spec.ts` | stats reflect win/loss, forfeit path |
