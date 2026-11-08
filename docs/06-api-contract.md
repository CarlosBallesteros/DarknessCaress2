# API Contract — the Wall

> The single source of truth for the HTTP surface. The frontend team and the backend team both implement against THIS file and nothing else about each other. No agent may reinterpret an endpoint — questions go through the gap protocol (`08-agent-rules.md`).

## Conventions (apply to every endpoint)

- Base path: `/api`. Production serves this from the same origin as the SPA (see `01-architecture.md`).
- **Success** response: `200`/`201`/`204` with a JSON body per endpoint below (no envelope — the body IS the resource).
- **Error** response: proper HTTP status with body `{"error": "<human-readable message>"}`. Statuses used: `400` validation, `401` not authenticated (`{"error":"Not authenticated"}`) and bad login, `404` unknown/not-yours (deliberate: existence is never leaked — see next rule), `409` state conflict (game cap, wrong phase, already finished), `429` rate limited, `503` board generation failed.
- Auth: every endpoint below except `register`, `login` requires the `dc_session` cookie (missing/invalid ⇒ `401 {"error":"Not authenticated"}`).
- All request bodies are validated with zod against the schemas below; failures = `400 {"error":"<first zod issue>"}`.
- Every game reference is owned by the authenticated user; a game id or unit id not belonging to the caller ⇒ `404 {"error":"Not found"}` — never `403`, which would betray that the resource exists.
- Timestamps are ISO 8601 strings.

## Shared DTOs (exact TypeScript/public shapes)

```ts
// user, as returned everywhere
interface User { id: string; email: string; username: string; theme: string; createdAt: string }

// board
interface Board { tiles: string[][] }        // 15x15, tile codes: "plain" | "forest" | "hill" | "lake" | "rock" | "river" | "bridge"

// unit
interface Unit {
  id: string;            // "<P|E>-<class>-<n>" (per 03's spawn): stable for the game's life — NOT a uuid
  side: "player" | "enemy";
  class: ClassKey;       // "sword"|"axe"|"spear"|"archer"|"mage"|"healer"
  x: number; y: number;  // current position
  hp: number; maxHp: number;
  acted: boolean;        // true once moved+acted this turn
}

// enemy's last produced turn (for board animation); actions in execution order
interface AiAction {
  unitId: string; path: [number, number][];   // starts at origin, ends on final tile
  action: { type: "attack"; targetId: string } | { type: "heal"; targetId: string } | { type: "wait" };
  outcome: {   // attack/heal only, exactly what the engine computed for the client's damage popups
    targetId: string; damage: number;            // damage dealt to the target (heal: amount healed)
    targetHp: number;                            // target's hp after the hit
    targetDied: boolean;
    counter: { damage: number; attackerHp: number } | null;  // attacker = this unit; null if no counter
  } | null;
}

// full game state, as returned by game endpoints
interface GameState {
  id: string; difficulty: string; status: "player_turn" | "ai_turn" | "won" | "lost";
  turnNumber: number; board: Board; units: Unit[];
  lastAiActions: AiAction[] | null;   // set after an AI turn applies
  updatedAt: string;
}

// games-list item
interface GameSummary { id: string; difficulty: string; status: GameState["status"]; turnNumber: number; updatedAt: string }
```

## Endpoints

| # | Method & path | Purpose | Auth |
|---|---|---|---|
| 1 | `POST /api/auth/register` | Create account | none |
| 2 | `POST /api/auth/login` | Get session cookie | none |
| 3 | `POST /api/auth/logout` | Clear cookie | any |
| 4 | `GET /api/me` | Current user | yes |
| 5 | `PATCH /api/me` | Change username / theme | yes |
| 6 | `PATCH /api/me/password` | Change password | yes |
| 7 | `GET /api/meta` | Public config subset (stats, personas, themes, lore) | yes |
| 8 | `GET /api/stats` | Statistics tab data | yes |
| 9 | `GET /api/games` | Games list (+ stale AI-turn recovery, see `01`) | yes |
| 10 | `POST /api/games` | Create game (runs board generation — may take ~10–60 s) | yes |
| 11 | `GET /api/games/:id` | Full game state (+ stale recovery) | yes |
| 12 | `GET /api/games/:id/preview/:unitId` | Move/action preview for one player unit | yes |
| 13 | `POST /api/games/:id/moves` | Submit all moves for the player's turn | yes |
| 14 | `POST /api/games/:id/end-turn` | End player turn → schedule AI turn | yes |
| 15 | `POST /api/games/:id/forfeit` | Concede | yes |

### 1. `POST /api/auth/register`

Request `{"email":"carlos@example.com","password":"correct-horse","username":"Carlos"}` (password ≥ 8; username 3–20, `[a-zA-Z0-9_-]`).

`201` → `{"user": User}` + session cookie. Errors: `400` validation; `409 {"error":"Email already registered"}` / `409 {"error":"Username already taken"}`.

### 2. `POST /api/auth/login` — `{"email":"carlos@example.com","password":"…"}` → `200 {"user": User}` + cookie. Errors: `401 {"error":"Invalid email or password"}` (same message for unknown email and wrong password), `429` over limit (10/min/IP, `express-rate-limit` in-memory).

### 3. `POST /api/auth/logout` → `204` (clears cookie; works even already-logged-out).

### 4. `GET /api/me` → `200 {"user": User}`.

### 5. `PATCH /api/me` — optional keys: `{"username?":"NewName","theme?":"warriors-europe"}` (at least one). `200 {"user": User}`. Errors: `400` validation, `409` username taken, `400 {"error":"Unknown theme"}`.

### 6. `PATCH /api/me/password` — `{"currentPassword":"…","newPassword":"…"}` → `204`. Errors: `400` validation, `401 {"error":"Current password is incorrect"}`. Other sessions stay valid (no revocation machinery in MVP).

### 7. `GET /api/meta` →

```json
{
  "boardSize": 15,
  "maxActiveGames": 5,
  "classes": {
    "sword": { "label": "Swordsman", "hp": 20, "atk": 7, "def": 5, "mov": 3, "range": [1], "role": "attacker", "count": 2 },
    "healer": { "label": "Healer", "hp": 18, "atk": 0, "def": 2, "mov": 2, "range": [], "role": "supporter", "count": 1, "healAmount": 8 }
  },
  "personalities": { "aggressive": { "label": "Aggressive" }, "defensive": { "label": "Defensive" }, "erratic": { "label": "Erratic" } },
  "themes": [{ "id": "warriors-europe", "label": "Champions of Europe" }],
  "lore": { "sword": "…", "axe": "…", "spear": "…", "archer": "…", "mage": "…", "healer": "…" }
}
```

### 8. `GET /api/stats` →

```json
{
  "gamesPlayed": 12, "wins": 7, "losses": 5, "winRate": 0.583,
  "byDifficulty": [
    { "difficulty": "aggressive", "played": 5, "wins": 3, "losses": 2 },
    { "difficulty": "defensive",  "played": 4, "wins": 3, "losses": 1 },
    { "difficulty": "erratic",    "played": 3, "wins": 1, "losses": 2 }
  ]
}
```

Games in flight (`player_turn`/`ai_turn`) are excluded; only `won`/`lost` count.

### 9. `GET /api/games` → `200 {"games":[GameSummary, …]}` ordered by **creation order** (`created_at` ascending) — position is the player's mental map, never reshuffled by activity; finished games stay in place (the client dims them). **Side effect (mandated):** before reading, re-trigger stale AI jobs for this user (`01-architecture.md` → stale recovery).

### 10. `POST /api/games` — `{"difficulty":"aggressive"}` (must be a personality id from config). Runs board generation (LLM brief + materialization, `03`) **synchronously**; then assembles both armies and inserts the row with `status: "player_turn"`, `turnNumber: 1`.

`201` → `{"game": GameState}`. Errors: `400 {"error":"Unknown difficulty"}`, `409 {"error":"Active game limit reached (5)"}` (the `(5)` is interpolated from `config.maxActiveGames`, not a literal; counting `player_turn`+`ai_turn` only). If board generation fails after its bounded retries (`03`): `503 {"error":"Battlefield generation failed, try again"}`.

### 11. `GET /api/games/:id` → `200 {"game": GameState}` (stale-recovery side effect as in 9, for this game). A game id that doesn't belong to the caller ⇒ `404 {"error":"Not found"}` per the conventions rule. While `ai_turn`, the response reflects the state at query time — no blocking, no long-polling.

### 12. `GET /api/games/:id/preview/:unitId` — only for the caller's units, only while `player_turn`, unit not yet `acted`.

```json
{ "moveTiles": [[4,5],[5,5]], "attackTiles": [[6,5]], "healTiles": [] }
```

- `moveTiles`: tiles reachable within Mov via legal pathing (water impassable outside bridges; enemies block; allies pass-through; Boolean per tile, no path enumeration).
- for classes with atk > 0: `attackTiles` = enemy-occupied tiles with distance ≤ class attack range **from any tile the unit can finish on** — i.e. tiles attackable THIS turn.
- for healer: `healTiles` = own-side (player) units adjacent-to-reach, hp < maxHp.
- Response is computed by `src/game/` shared code: identical logic serves moves validation; the client renders it as overlay. Errors: `404 {"error":"Unit not playable"}` (unknown, not owner's, or already acted this turn); `409 {"error":"Game is not waiting for your turn"}`.

### 13. `POST /api/games/:id/moves` — validates & applies the whole player turn atomically (single transaction).

Request:

```json
{ "moves": [
  { "unitId": "P-sword-1", "path": [[4,4],[5,4]], "action": { "type": "attack", "targetId": "E-axe-1" } },
  { "unitId": "P-archer-1", "path": [[9,9]], "action": { "type": "wait" } }
]}
```

- Server re-derives `path` legality with the same engine used by preview; `path[0]` must be the unit's current tile; the path may pass through ally-occupied tiles (allies do not block passage) but the final tile must be empty; enemy-occupied tiles may NOT be entered; attack requires Manhattan distance `|dx|+|dy|` between `path.at(-1)` and the target within the attacker's class range, target on the opposite side; heal requires healer adjacency, same side, and target hp < max hp; every `unitId` must belong to the acting side with `acted=false`; each unit appears at most once.
- Applies in request order: teleport along validated path (positions update), computes attack & counter server-side exactly `02 defines`, heal by `healAmount`, sets `acted: true`.
- `200 {"game": GameState}` — same status still `player_turn`; acting is separate.
- Errors: `400 {"error":"<which move failed and why>"}` (e.g. `"move 1: archer cannot attack a unit at 3 tiles"`). Apply nothing on any failure — validation is holistic before the first mutation.

### 14. `POST /api/games/:id/end-turn` — only from `player_turn`; no request body. No concept of "partly acted units" — moves were already applied atomically by endpoint 13, so ending the turn is pure state transition (any un-acted units simply do nothing this turn).

Effects: `status = "ai_turn"`, `updated_at = now()`, **all units' `acted` flags reset to `false`** (the player's just-expired units stop acting; the enemy army is armed for ITS turn — the reset covers both sides in one stroke), fire background `runAiTurn` (non-blocking per `01`). Response: `200 {"game": GameState}` with `status:"ai_turn"`. Errors: `409 {"error":"Game is not waiting for your turn"}`.

Victory check also runs here and on 13: if all enemy units are dead, no AI turn happens — `status = "won"` directly. Symmetrically, AI-side engine sets `status = "lost"` after its actions if the player is wiped.

### 15. `POST /api/games/:id/forfeit` — from `player_turn` or `ai_turn` → `status = "lost"` → `200 {"game": GameState}`. Idempotent when already finished (`409 {"error":"Game already finished"}` otherwise).

## Status matrix (the only legal transitions)

```
player_turn → ai_turn            (explicit: completed)
ai_turn → player_turn            (AI: worked)
ai_turn → won | lost             (AI: conditions met: enemy/player army destroyed)
player_turn → won                (all enemies dead by the player's actions before end-turn)
any_active → lost                (forfeit)
```

No transition exists `won`→`anything`, `lost`→`anything`. A `won`/`lost` game's board keeps being readable via endpoint 11 (stats include it; "New game" offers a rematch in style: it becomes a NEW game).

## Notes binding both sides

- The client never mutates local game state from its own input except optimistically for readability — every authoritative state comes from these endpoints' responses; after each response the client **replaces** its local `GameState` wholesale.
- The polling contract (client side): list view polls `GET /api/games` every 3 s while any owned game is `ai_turn`; board view polls `GET /api/games/:id` every 3 s while that game is `ai_turn`; NO polling when all games/idle.
- 3-second polling is a floor, not a ceiling — the promise is "state converges within seconds of an AI turn finishing".
