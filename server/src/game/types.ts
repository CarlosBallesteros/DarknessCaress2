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
  // one unit's turn bundle, exactly the API contract's shape
  unitId: string;
  path: [number, number][]; // path[0] = current tile … path.at(-1) = final tile
  action:
    { type: "attack"; targetId: string } | { type: "heal"; targetId: string } | { type: "wait" };
}

export interface AppliedTurn {
  events: Array<
    | { kind: "moved"; unitId: string; from: [number, number]; to: [number, number] }
    | { kind: "attack"; attackerId: string; targetId: string; damage: number; targetHp: number }
    | { kind: "counter"; attackerId: string; targetId: string; damage: number; targetHp: number }
    | { kind: "heal"; healerId: string; targetId: string; healed: number; targetHp: number }
    | { kind: "died"; unitId: string }
    | { kind: "wait"; unitId: string }
  >;
  state: { board: Board; units: Unit[] }; // NEW state; caller persists it
}

export interface GameEngineConfig {
  // projected from server/config.json — the engine never reads the file
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
