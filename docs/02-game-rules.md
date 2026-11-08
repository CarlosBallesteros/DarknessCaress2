# Game Rules — the Pure Engine

> Everything here lives in `server/src/game/` — a pure module with **zero I/O** (no DB, no LLM, no network). Both the API (move validation, previews) and the AI pipeline (applying the LLM's decisions) call this same module. If it's not game I/O, it belongs here.

## Types (canonical — `src/game/types.ts`)

```ts
export const SIZE = 15; // boardSize also lives in config; engine takes size as an argument — tests parametrize it

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
  classes: Record<ClassKey, { hp: number; atk: number; def: number; mov: number; range: number[]; healAmount?: number; role?: "attacker" | "supporter" }>;
}
// Note: `role` rides along as metadata (consumed by the AI prompt layer + spawn layout);
// engine MATH must never branch on it — a class's role tag can never alter damage, movement, or range.
```

## Movement (`src/game/reach.ts`)

- Grid, 4-neighborhood, every step costs 1. **Terrain never affects movement cost** (cosmetic only) — except: `lake` and `river` tiles are impassable; `bridge` is walkable.
- A path may pass **through ally-occupied tiles** but may not END on any occupied tile, and may not ENTER enemy-occupied tiles at all.
- Reachable = every tile with a legal path of length ≤ `unit.mov`. BFS with a visited set — sufficient and exact here (all step costs equal 1, so BFS distance = optimal distance).

```ts
export function reachableTiles(board: Board, units: Unit[], unit: Unit, size: number): Set<string>; // keys "x,y"
export function isPathLegal(board: Board, units: Unit[], unit: Unit, path: [number, number][], size: number): string | null;
// isPathLegal returns null when legal, otherwise a precise rejection message like:
//   "path step (4,6) is water" | "path ends on an occupied tile" | "path enters an enemy unit at (7,8)"
//   | "path length 4 exceeds movement 3" | "path must start at the unit's tile"
```

No path reconstruction, no ranged movement points, no diagonal — nothing else exists.

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

1. **Whole-bundle validation first** (fail without touching anything):
   - unit exists, belongs to `side`, `acted === false`; each unit used at most once;
   - `isPathLegal` passes for every move.
2. Apply moves **in request order**: movement = teleport to `path.at(-1)` (validation proved the path exists, no step simulation needed).
3. **Attack**: attacker and target must still be alive, opposite sides, and Manhattan distance `|dx| + |dy|` from the ATTACKER'S FINAL TILE must be in `range`. Damage = `max(0, atk − target.def)` (never randomized). Target HP decrements; `hp ≤ 0` ⇒ dead ⇒ removed.
4. **Counter** — the exact rule: if the target survived and the target's class can attack (`atk > 0`, archers/mages have their own range; healer never) and the ATTACKER'S FINAL TILE lies within the TARGET'S range measured from the target's tile ⇒ the target deals `max(0, targetAtk − attackerDef)` back. One counter per attack; the counter can kill.
5. **Heal**: healer only, target = same side, alive, Manhattan distance 1 (adjacent), `hp < maxHp`; healed = `min(healAmount, maxHp − hp)`. Healers have no attack action at all.
6. **Wait**: legal anywhere. A unit given no move stays `acted: false` (skipping your units is allowed and costs nothing).
7. Set `acted: true` for every unit that received a move. Reset of `acted` happens at turn flips, in feature code — the engine doesn't track turns. (The reset is DEFINED in `06`: `POST /end-turn` resets all units' flags before scheduling the AI turn.)

## Turn semantics

- There is no "partially acted" turn. The player may submit fewer than 10 moves; un-acted units simply do nothing when the turn ends.
- Enemy and player armies are separate turn phases; the engine's `side` parameter says which army is acting.

## Previews (`src/game/reach.ts` again — same source as validation)

```ts
export function previewMove(board: Board, units: Unit[], unit: Unit, cfg: GameEngineConfig, size: number): {
  moveTiles: [number, number][];
  attackTiles: [number, number][];   // for atk>0: enemy tiles attackable THIS turn from any reachable final tile
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
| path illegal | the precise `isPathLegal` message above |
| target out of range | `<class> cannot attack a unit at <n> tiles` |
| target wrong side / dead | `<id> is not a valid attack target` |
| not adjacent (heal) / full hp | `heal target must be adjacent and wounded` |
| duplicate unit in bundle | `<id> appears twice` |

## Engine tests (Vitest — the real backbone of the suite)

`server/src/game/apply.test.ts` + `reach.test.ts` cover at least:

1. straight movement up to Mov; blocked by enemy; pass-through ally; water blocked except bridge.
2. attack + counter both ways (each class distance matrix: mage-3-no-counter-by-range1, archer-2-mutual, spear-1-mutual).
3. damage floor at 0, heal clamping, death removes unit.
4. healer cannot attack (no `attack` action type accepted from healer side either).
5. `acted` semantics; duplicate rejection; whole-bundle atomicity (one bad move ⇒ `{ok:false}`, state untouched).
6. victory check both directions.
7. preview matches reachable/attack on a hand-built sample board.

Parametrized with the real config values where relevant, so rebalancing the config re-validates itself by rerunning the suite.
