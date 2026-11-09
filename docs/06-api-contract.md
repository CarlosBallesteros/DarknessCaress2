# API Contract — the Wall

> The single source of truth for the HTTP surface. The frontend team and the backend team both implement against THIS file and nothing else about each other. No agent may reinterpret an endpoint — questions go through the gap protocol (`08-agent-rules.md`).

## Conventions (apply to every endpoint)

- Base path: `/api`. Production serves this from the same origin as the SPA (see `01-architecture.md`).
- **Success** response: `200`/`201`/`204` with a JSON body per endpoint below — no generic wrapper (no `{"data":…}` envelope): the body IS the resource, under its natural top-level key (`{"user": …}`, `{"game": …}`, `{"games": […]}`).
- **Error** response: proper HTTP status with body `{"error": "<human-readable message>"}`. Statuses used: `400` validation, `401` not authenticated (`{"error":"Not authenticated"}`) and bad login, `404` unknown/not-yours (deliberate: existence is never leaked — see next rule), `409` state conflict (game cap, wrong phase, already finished), `429` rate limited, `503` board generation failed.
- Auth: every endpoint below except `health`, `meta`, `register`, `login`, `logout` requires the `dc_session` cookie (missing/invalid ⇒ `401 {"error":"Not authenticated"}`; logout is deliberately exempt — it must always succeed, even with no session; `meta` is deliberately public — the landing page needs the default theme and the data shown is harmless game metadata).
- All request bodies are validated with zod against the schemas below; failures = `400 {"error":"<first zod issue>"}`.
- Every game reference is owned by the authenticated user; a game id not belonging to the caller ⇒ `404 {"error":"Not found"}` — never `403`, which would betray that the resource exists. Endpoint-specific 404 bodies (e.g. `{"error":"Unit not playable"}`) are allowed when they likewise leak nothing — "not playable" covers unknown-or-foreign unit ids without revealing which.
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
    counter: { damage: number; attackerHp: number } | null;  // attacker = this unit; null if no counter.
                                                             // Mapping (feature code): engine counter event
                                                             // carries targetId = the COUNTERER + its post-hit hp;
                                                             // the DTO flips it: damage goes to counter.damage,
                                                             // attackerHp = the attacker's hp AFTER the counter,
                                                             // read from the applied state — never recomputed client-side.
  } | null;
}

// full game state, as returned by game endpoints
interface GameState {
  id: string; difficulty: string; status: "player_turn" | "ai_turn" | "won" | "lost";
  turnNumber: number; board: Board; units: Unit[];
  lastAiActions: AiAction[] | null;   // set after an AI turn applies; REPLACED by the next AI turn,
                                      // null at creation. The client animates only the poll response
                                      // that flipped the status — stale actions are never re-animated.
  updatedAt: string;
}

// games-list item
interface GameSummary { id: string; difficulty: string; status: GameState["status"]; turnNumber: number; updatedAt: string }
```

## Endpoints

| # | Method & path | Purpose | Auth |
|---|---|---|---|
| 0 | `GET /api/health` | Liveness probe — `200 {"ok": true}` always, no auth, no zod | none |
| 1 | `POST /api/auth/register` | Create account | none |
| 2 | `POST /api/auth/login` | Get session cookie | none |
| 3 | `POST /api/auth/logout` | Clear cookie | any |
| 4 | `GET /api/me` | Current user | yes |
| 5 | `PATCH /api/me` | Change username / theme | yes |
| 6 | `PATCH /api/me/password` | Change password | yes |
| 7 | `GET /api/meta` | Public config subset (stats, personas, themes, lore) | none |
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

### 5. `PATCH /api/me` — optional keys: `{"username?":"NewName","theme?":"warriors-europe"}` — the `?` marks TS-optional keys (send ANY ZERO OR MORE of `username`/`theme`; at least one key must be present). `200 {"user": User}`. Errors: `400` validation, `409` username taken, `400 {"error":"Unknown theme"}`.

### 6. `PATCH /api/me/password` — `{"currentPassword":"…","newPassword":"…"}` → `204`. Errors: `400` validation, `401 {"error":"Current password is incorrect"}`. Other sessions stay valid (no revocation machinery in MVP).

### 7. `GET /api/meta` — deliberately public (the landing page fetches the default theme from here; the body is harmless game metadata).

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

(The example shows only 2 of the class keys for brevity — the response carries **every** class present in `config.classes`, all six at baseline, since the Champions tab renders one card each.)

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
- for classes with atk > 0: `attackTiles` = enemy-occupied tiles whose Manhattan distance from some reachable final tile **is a member of the class's range list** (set membership — an archer's `[2]` marks exactly distance-2 tiles, never distance 1 or 3).
- for healer: `healTiles` = same-side (player) units **Manhattan-adjacent to any reachable final tile**, hp < maxHp.
- Response is computed by `src/game/` shared code: identical logic serves moves validation; the client renders it as overlay. Note: the preview returns TILES ONLY (no paths) — the client computes its own display path for the staged bundle (`05`), and the server re-validates that path on submission. Errors: `404 {"error":"Unit not playable"}` (unknown, not owner's, or already acted this turn); `409 {"error":"Game is not waiting for your turn"}`.

### 13. `POST /api/games/:id/moves` — validates & applies the whole player turn atomically (single transaction).

Request:

```json
{ "moves": [
  { "unitId": "P-sword-1", "path": [[4,4],[5,4]], "action": { "type": "attack", "targetId": "E-axe-1" } },
  { "unitId": "P-archer-1", "path": [[9,9]], "action": { "type": "wait" } }
]}
```

- Server re-derives `path` legality with the same engine used by preview; `path[0]` must be the unit's current tile; the path may pass through ally-occupied tiles (allies do not block passage) but the final tile must be empty; enemy-occupied tiles may NOT be entered; **the landing-tile rule applies**: the bundle's final tiles must be pairwise distinct and empty in the pre-move state (no stacking, no chain-following — `02`); attack requires Manhattan distance `|dx|+|dy|` between `path.at(-1)` and the target within the attacker's class range, target on the opposite side; heal requires Manhattan-1 from the healer's final tile, same side, and target hp < max hp; every `unitId` must belong to the acting side with `acted=false`; each unit appears at most once.
- Applies in **strict sequential entry order** (exactly as `02` defines: each move's teleport, then its attack + counter or heal, fully resolved to the death outcome before the next entry begins), sets `acted: true` on **every unit that received an entry — explicitly including `wait` entries (omitted units stay `acted: false`). The user-facing consequence lives in the END-TURN confirm dialog in `05`.**
- `200 {"game": GameState}` — status stays `player_turn` **unless the victory short-circuit fires** (all enemies wiped by these moves ⇒ `status = "won"` directly, per the status matrix; no `/end-turn` may follow).
- Errors: `400 {"error":"<which move failed and why>"}` (e.g. `"move 1: archer cannot attack a unit at 3 tiles"` — the exact engine message from `02`'s catalogue; zod shape-failures on the REQUEST bundle produce the generic first-issue body from the conventions above); `409 {"error":"Game is not waiting for your turn"}` when the game isn't in `player_turn`. Apply nothing on any failure — validation is holistic before the first mutation.
- **Exactly ONE *successful* `POST /moves` per round**: once a bundle has been APPLIED this round, a further call during the same `player_turn` ⇒ `409 {"error":"Turn moves already submitted"}` (this is what keeps the landing-tile rule honest across requests — chain-following via two submissions is impossible by construction). **Failed (400) attempts do not consume this budget** — fix the staged bundle and re-submit freely; only an applied bundle locks the round.

### 14. `POST /api/games/:id/end-turn` — only from `player_turn`; no request body. No concept of "partly acted units" — moves were already applied atomically by endpoint 13, so ending the turn is pure state transition (any un-acted units simply do nothing this turn).

Effects: `status = "ai_turn"`, `updated_at = now()`, **all units' `acted` flags reset to `false`** (the player's just-expired units stop acting; the enemy army is armed for ITS turn — the reset covers both sides in one stroke), `turnNumber` unchanged (it advances only when a successful AI turn completes — `04`'s loop — so the counter is the **1-based CURRENT round**: 1 = the player's opening turn, 2 = after the first AI turn, …), fire background `runAiTurn` (non-blocking per `01`). Response: `200 {"game": GameState}` with `status:"ai_turn"`. Errors: `409 {"error":"Game is not waiting for your turn"}`.

Victory check also runs here and on 13: if all enemy units are dead, no AI turn happens — `status = "won"` directly. Symmetrically, AI-side engine sets `status = "lost"` after its actions if the player is wiped.

### 15. `POST /api/games/:id/forfeit` — from `player_turn` or `ai_turn` → `status = "lost"` → `200 {"game": GameState}`. Forfeiting an already-finished game is rejected: `409 {"error":"Game already finished"}` (there is no idempotent-success on finished games; repeat calls on an ACTIVE game before it finishes are harmless — only the first flip counts).

## Status matrix (the only legal transitions)

```
player_turn → ai_turn            (explicit: completed)
ai_turn → player_turn            (AI: worked)
ai_turn → lost                   (AI: conditions met — the player's army was wiped)
player_turn → won                (all enemies dead by the player's actions before end-turn)
any_active → lost                (forfeit)
```

`ai_turn → won` does NOT exist — the AI can never destroy its own army, so a player victory is only ever produced by endpoint 13 (or a forfeit's mirror: `ai_turn → lost`).

No transition exists `won`→`anything`, `lost`→`anything`. A `won`/`lost` game's board keeps being readable via endpoint 11 (stats include it; "New game" offers a rematch in style: it becomes a NEW game).

## Notes binding both sides

- The client never mutates local game state from its own input except optimistically for readability — every authoritative state comes from these endpoints' responses; after each response the client **replaces** its local `GameState` wholesale.
- The polling contract (client side): list view polls `GET /api/games` every 3 s while any owned game is `ai_turn`; board view polls `GET /api/games/:id` every 3 s while that game is `ai_turn`; NO polling when all games/idle.
- 3-second polling is a floor, not a ceiling — the promise is "state converges within seconds of an AI turn finishing".
