export const SIZE = 8; // fixture default for tests — production code derives size from GameEngineConfig.boardSize

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
  unitId: string;
  path: [number, number][]; // path[0] = current tile … path.at(-1) = final tile
  action:
    | { type: "attack"; targetId: string }
    | { type: "heal"; targetId: string }
    | { type: "wait" };
}

export interface GameEngineConfig {
  boardSize: number;
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
