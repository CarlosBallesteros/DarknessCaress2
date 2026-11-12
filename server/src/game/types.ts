export type TileCode = "plain" | "forest" | "hill" | "lake" | "river" | "bridge" | "rock";

export interface Coord {
  x: number;
  y: number;
}

export interface Unit {
  id: string;
  classKey: string;
  side: "player" | "enemy";
  hp: number;
  x: number;
  y: number;
}

export interface Board {
  tiles: TileCode[][];
}

export interface GameState {
  board: Board;
  units: Unit[];
  turnNumber: number;
  status: string;
}

export interface ClassConfig {
  count: number;
  hp: number;
  atk: number;
  def: number;
  mov: number;
  range: number[];
  role: "attacker" | "supporter";
  label: string;
  healAmount?: number;
}

export interface GameEngineConfig {
  boardSize: number;
  classes: Record<string, ClassConfig>;
}
