// Canonical engine types per docs/02. This module (and all of src/game/) is a
// PURE rules engine: zero I/O, no imports from features/ — features import from
// here, never the reverse (docs/01 layout rules).

export const SIZE = 15; // hardcoded ONLY as a fixture default for tests — production code derives
// the grid size from GameEngineConfig.boardSize. Never read SIZE in engine math.

export type Tile = "plain" | "forest" | "hill" | "lake" | "rock" | "river" | "bridge";
export type ClassKey = "sword" | "axe" | "spear" | "archer" | "mage" | "healer";
export type Side = "player" | "enemy";

export interface Unit {
  id: string;
  side: Side;
  class: ClassKey;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  acted: boolean;
}

export interface Board {
  tiles: Tile[][]; // [y][x]
}

export interface Move {
  // one unit's turn bundle entry, exactly the API contract's shape
  unitId: string;
  path: [number, number][]; // path[0] = current tile … path.at(-1) = final tile
  action:
    { type: "attack"; targetId: string } | { type: "heal"; targetId: string } | { type: "wait" };
}

export interface GameEngineConfig {
  // projected from server/config.json by src/config/engine.ts — the engine never reads the file
  boardSize: number; // the ONE source of grid size — reach/parsing derive it from here
  classes: Record<
    ClassKey,
    {
      count: number;
      hp: number;
      atk: number;
      def: number;
      mov: number;
      range: number[];
      healAmount?: number;
      role?: "attacker" | "supporter";
    }
  >;
}
// `count` and `role` ride along as METADATA (army assembly + AI prompt layer);
// engine MATH must never branch on either — damage, movement, range come only
// from the stat fields.
