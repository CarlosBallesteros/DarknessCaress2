export type ClassKey = "sword" | "axe" | "spear" | "archer" | "mage" | "healer";

export interface User {
  id: string;
  email: string;
  username: string;
  theme: string;
  createdAt: string;
}

export type TileCode = "plain" | "forest" | "hill" | "lake" | "rock" | "river" | "bridge";

export interface Board {
  tiles: string[][];
}

export interface Unit {
  id: string;
  side: "player" | "enemy";
  class: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  acted: boolean;
}

export type AiAction =
  | {
      unitId: string;
      path: [number, number][];
      action: { type: "attack"; targetId: string };
      outcome: {
        targetId: string;
        damage: number;
        targetHp: number;
        targetDied: boolean;
        counter: { damage: number; attackerHp: number } | null;
      } | null;
    }
  | {
      unitId: string;
      path: [number, number][];
      action: { type: "heal"; targetId: string };
      outcome: {
        targetId: string;
        damage: number;
        targetHp: number;
        targetDied: boolean;
        counter: { damage: number; attackerHp: number } | null;
      } | null;
    }
  | {
      unitId: string;
      path: [number, number][];
      action: { type: "wait" };
      outcome: null;
    };

export type GameStatus = "generating_board" | "player_turn" | "ai_turn" | "won" | "lost";

export interface GameState {
  id: string;
  difficulty: string;
  status: GameStatus;
  turnNumber: number;
  board: Board;
  units: Unit[];
  lastAiActions: AiAction[] | null;
  updatedAt: string;
}

export interface GameSummary {
  id: string;
  difficulty: string;
  status: GameStatus;
  turnNumber: number;
  updatedAt: string;
  previewBoard: Board;
  previewUnits: Array<{ x: number; y: number; side: "player" | "enemy" }>;
}

export interface MetaClass {
  label: string;
  hp: number;
  atk: number;
  def: number;
  mov: number;
  range: number[];
  role: "attacker" | "supporter";
  count: number;
  healAmount?: number;
}

export interface Meta {
  boardSize: number;
  maxActiveGames: number;
  classes: Record<string, MetaClass>;
  personalities: Record<string, { label: string }>;
  themes: Array<{ id: string; label: string }>;
  lore: Record<string, string>;
}

export interface Stats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  byDifficulty: Array<{
    difficulty: string;
    played: number;
    wins: number;
    losses: number;
  }>;
}

export interface PreviewResponse {
  moveTiles: [number, number][];
  attackTiles: [number, number][];
  healTiles: [number, number][];
  side: "player" | "enemy";
}

export type MoveAction =
  { type: "attack"; targetId: string } | { type: "heal"; targetId: string } | { type: "wait" };

export interface MovePayload {
  unitId: string;
  path: [number, number][];
  action: MoveAction;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}
