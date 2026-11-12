# Game Rules — the Pure Engine

> Everything here lives in `server/src/game/` — a pure module with **zero I/O** (no DB, no LLM, no network). Both the API (move validation, previews) and the AI pipeline (applying the LLM's decisions) call this same module. If it's not game I/O, it belongs here.

## Types (canonical — `src/game/types.ts`)

```ts
export const SIZE = 8; // hardcoded ONLY as a fixture default for tests — production code derives
                       // the grid size from GameEngineConfig.boardSize. Never read SIZE in engine math.

export type Tile = "plain" | "forest" | "hill" | "lake" | "rock" | "river" | "bridge";
export type ClassKey = "sword" | "axe" | "spear" | "archer" | "mage" | "healer";
export type Side = "player" | "enemy";

export interface Unit {
  id: string;
  side: Side;
  class: ClassKey;
  x: number; y: number;
  hp: number; maxHp: number;
  acted: boolean;
}

export interface Board { tiles: Tile[][] } // [y][x]

export interface Move {   // one unit's turn bundle, exactly the API contract's shape
  unitId: string;
  path: [number, number][];   // path[0] = current tile … path.at(-1) = final tile
  action:
    | { type: "attack"; targetId: string }
    | { type: "heal"; targetId: string }
    | { type: "wait" };
}

export interface GameEngineConfig {   // projected from server/config.json — the engine never reads the file
  boardSize: number;                   // the ONE source of grid size — reach/parsing derive it from here
  classes: Record<ClassKey, { count: number; hp: number; atk: number; def: number; mov: number; range: number[]; healAmount?: number; role?: "attacker" | "supporter" }>;
}
// `count` and `role` ride along as METADATA (army assembly + AI prompt layer);
// engine MATH must never branch on either — damage, movement, range come only from the stat fields.
```

## Movement (`src/game/reach.ts`)

- Grid, 4-neighborhood, every step costs 1. **Terrain never affects movement cost or speed** — water is the ONE mechanical exception: `lake` and `river` tiles are impassable, `bridge` is walkable.
- A path may pass **through ally-occupied tiles** but may not END on any occupied tile, and may not ENTER enemy-occupied tiles at all — with ONE ownership exception: the tile occupied by THE MOVING UNIT ITSELF counts as free while it moves (this is what makes a Wait entry — a 1-entry path at the unit's own tile — legal).
- Reachable = every tile with a legal path of length ≤ `unit.mov`. BFS with a visited set — sufficient and exact here (all step costs equal 1, so BFS distance = optimal distance).

```ts
export function reachableTiles(board: Board, units: Unit[], unit: Unit, cfg: GameEngineConfig): Set<string>; // keys "x,y"; size from cfg.boardSize
export function isPathLegal(board: Board, units: Unit[], unit: Unit, path: [number, number][], cfg: GameEngineConfig): string | null;
// isPathLegal returns null when legal, otherwise a precise rejection message like:
//   "path step (4,6) is water" | "path ends on an occupied tile" | "path enters an enemy unit at (7,8)"
//   | "path length 4 exceeds movement 3" | "path must start at the unit's tile"
// "path length" = the number of EDGES stepped = path.length − 1 (entries − 1).
// Examples: a 4-entry array = 3 edges; a Mov-2 class accepts at most 2 edges and rejects a
// 4-entry array with "path length 3 exceeds movement 2". The message's N = edges, M = Mov.
```

No path reconstruction for the PLAYER contract — nothing else exists. (The ONE
pure exception, added by the v3 AI-menu amendment: `pathTo` below — used ONLY by
the AI job to expand destination-only AI orders into full legal paths; the player
contract always requires the full walked route and never uses it.)

```ts
// AI-job helper (docs/04 menu amendment): the deterministic BFS shortest legal
// route from the unit's tile to `dest` — same traversal rules as
// reachableTiles (4-neighborhood, water impassable outside bridges, allies
// pass-through, dest must be STANDABLE in the given snapshot). Returns the
// full tile list origin→dest inclusive, or null when `dest` is not reachable
// in this snapshot. Deterministic given the inputs; the caller then submits
// the expanded path through the normal applyMoves machinery, where the
// EVOLVING landing rule still governs (a menu tile claimed by an earlier
// bundle entry is rejected exactly like any other landing clash).
export function pathTo(
  board: Board,
  units: Unit[],
  unit: Unit,
  dest: [number, number],
  cfg: GameEngineConfig,
): Array<[number, number]> | null;
```

## Turn execution (`src/game/apply.ts`)

```ts
export interface AppliedTurn {
  events: Array<
    | { kind: "moved"; unitId: string; from: [number, number]; to: [number, number] }
    | { kind: "attack"; attackerId: string; targetId: string; damage: number; targetHp: number }
    | { kind: "counter"; attackerId: string; targetId: string; damage: number; targetHp: number } // targetId = the counterer
    | { kind: "heal"; healerId: string; targetId: string; healed: number; targetHp: number }
    | { kind: "died"; unitId: string }
    | { kind: "wait"; unitId: string }
  >;
  state: { board: Board; units: Unit[] };   // NEW state; caller persists it
}
export function applyMoves(
  state: { board: Board; units: Unit[] },
  moves: Move[],
  side: Side,
  cfg: GameEngineConfig,
): { ok: true; result: AppliedTurn } | { ok: false; error: string };
```

Execution order and rules, exactly:

1. **Whole-bundle validation, entry by entry, against the EVOLVING state** (fail without touching anything — a failing entry rejects the whole bundle):
   - unit exists, belongs to `side`, `acted === false`; each unit used at most once;
   - `isPathLegal` passes for every move, judged against the state AS EVOLVED by all EARLIER entries (entries apply sequentially; validation and application share the same running copy — "would this entry succeed if submitted alone, right now?" applied along the chain);
   - **landing rule (evolving):** the FINAL tile must be empty in the evolving state —able to be empty because an EARLIER entry vacated it (chain-following is LEGAL: players may retreat/reorganize through their own opened gaps, in bundle order). A unit may NOT end on a tile currently occupied in the evolving state (by any unmoved unit, or by an earlier entry's landing), may not ENTER enemy-occupied tiles, and other entries may never LAND on this entry's final tile (claiming is exclusive: two entries to one tile still reject);
   - **Wait entries are exempt** (final tile = own pre-move tile — nothing claimed, nothing needed).
2. Apply moves **in strict sequential order**: each bundle entry completes fully (movement teleports to `path.at(-1)`, then its attack + optional counter or heal resolve to the death/removal outcome) BEFORE the next entry begins — a unit killed by a counter never executes a later entry, and damage is never simultaneous.
3. **Attack**: attacker and target must still be alive, opposite sides, and Manhattan distance `|dx| + |dy|` from the ATTACKER'S FINAL TILE must be in `range`. Damage = `max(0, atk − target.def)` (never randomized). Target HP decrements; `hp ≤ 0` ⇒ dead ⇒ removed.
4. **Counter** — the exact rule: if the target survived and the target's class can attack (`atk > 0`, archers/mages have their own range; healer never) and the ATTACKER'S FINAL TILE lies within the TARGET'S range measured from the target's tile ⇒ the target deals `max(0, targetAtk − attackerDef)` back. One counter per attack; the counter can kill.
5. **Heal**: healer only, target = same side, alive, Manhattan distance 1 (adjacent), `hp < maxHp`; healed = `min(healAmount, maxHp − hp)`. Healers have no attack action at all.
6. **Wait**: legal anywhere. A unit given no move stays `acted: false` (skipping your units is allowed and costs nothing).
7. Set `acted: true` for every unit that received an entry — a `wait` entry COUNTS (only omission leaves `acted: false`). Reset of `acted` happens at turn flips, in feature code — the engine doesn't track turns. (The reset is DEFINED in `06`: `POST /end-turn` resets all units' flags before scheduling the AI turn.)

## Turn semantics

- There is no "partially acted" turn. The player may submit fewer than 10 moves (10 = the fixed army, i.e. the sum of `config.classes[*].count`: 2+2+2+2+1+1 — assembled by the board feature from those counts, never hardcoded); un-acted units simply do nothing when the turn ends.
- Enemy and player armies are separate turn phases; the engine's `side` parameter says which army is acting.

## Previews (`src/game/reach.ts` again — same source as validation)

```ts
export function previewMove(board: Board, units: Unit[], unit: Unit, cfg: GameEngineConfig): {
  moveTiles: [number, number][];
  attackTiles: [number, number][];   // enemy tiles at Manhattan distance ∈ the class's range LIST
                                     // (set membership, not ≤ max — range [2] marks exactly distance-2)
                                     // from any reachable final tile
  healTiles: [number, number][];    // for healer: same-side units healable this turn
};
```

Used verbatim by `GET /api/games/:id/preview/:unitId` and rendered by the client overlay.

## Victory check (`src/game/apply.ts`)

```ts
export function checkVictory(units: Unit[]): "player" | "enemy" | null;
// "player" = enemy army wiped (player won). "enemy" = player army wiped.
```

Called by feature code after applying the player's moves (before scheduling an AI turn) and after applying AI actions.

## Processing of AI output (`src/game/apply.ts`)

The LLM never computes damage, counters, or deaths — it only **decides** moves; this engine executes. The validation loop for AI moves is the exact pipeline: `aiTurn → parse → applyMoves(state, moves, "enemy", cfg) → retry on { ok: false } with the error fed back to the LLM` (bounded, in `04-ai-integration.md`).

## Rejection message catalogue (validator must produce exactly these kinds)

| Cause | Message pattern |
|---|---|
| unit unknown | `unknown unit <id>` |
| wrong side | `<id> belongs to the other army` |
| already acted | `<id> already acted this turn` |
| path illegal | the precise `isPathLegal` message above, which includes: `path step (x,y) is outside the board`, `path step (x,y) is not adjacent to the previous step` (both forced by the 4-neighborhood rule), plus the listed movement rejections |
| landing clash | `tile (x,y) is claimed by two moves` / `tile (x,y) is occupied in the current position of the turn chain` |
| attack/heal missing targetId | `attack requires a target` / `heal requires a target` |
| target out of range | `<class> cannot attack a unit at <n> tiles` |
| target wrong side / dead | `<id> is not a valid attack target` |
| not adjacent (heal) / full hp | `heal target must be adjacent and wounded` |
| duplicate unit in bundle | `<id> appears twice` |
| attack/heal by a non-capable class | `<class> cannot attack` / `<class> cannot heal` (e.g. "healer cannot attack"; uses the class KEY, labels are UI-side) |
| unknown action type | `unknown action "<type>"` |
| attack/heal target id unknown | `unknown unit <id>` (same row as the unit-unknown case) |

## Engine tests (Vitest — the real backbone of the suite)

`server/src/game/apply.test.ts` + `reach.test.ts` cover at least:

1. straight movement up to Mov; blocked by enemy; pass-through ally; water blocked except bridge.
2. attack + counter both ways (each class distance matrix: mage-3-no-counter-by-range1, archer-2-mutual, spear-1-mutual, healer never).
3. damage floor at 0, heal clamping, death removes unit.
4. healer cannot attack (no `attack` action type accepted from healer side either).
5. `acted` semantics; duplicate rejection; EVOLVING landing validation (chain-follow success now PASSES: entry 1 vacates a tile, entry 2 lands there — legal; two entries claiming the SAME evolving tile ⇒ reject; entering a still-occupied tile ⇒ reject); whole-bundle atomicity (one bad move ⇒ `{ok:false}`, state untouched); sequential resolution (a killed-attacker's later entry never executes).
6. victory check both directions.
7. preview matches reachable/attack on a hand-built sample board.

Parametrized with the real config values where relevant, so rebalancing the config re-validates itself by rerunning the suite.
