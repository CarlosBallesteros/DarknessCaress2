import type { Board, Unit } from "../../game/types.js";

export type GameStatus = "generating_board" | "player_turn" | "ai_turn" | "won" | "lost";

export interface AiActionDto {
  unitId: string;
  path: [number, number][];
  action:
    { type: "attack"; targetId: string } | { type: "heal"; targetId: string } | { type: "wait" };
  outcome: {
    targetId: string;
    damage: number;
    targetHp: number;
    targetDied: boolean;
    counter: { damage: number; attackerHp: number } | null;
  } | null;
}

export interface GameStateDto {
  id: string;
  difficulty: string;
  status: GameStatus;
  turnNumber: number;
  board: { tiles: string[][] };
  units: Array<{
    id: string;
    side: "player" | "enemy";
    class: string;
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    acted: boolean;
  }>;
  lastAiActions: AiActionDto[] | null;
  updatedAt: string;
}

export interface GameSummaryDto {
  id: string;
  difficulty: string;
  status: GameStatus;
  turnNumber: number;
  updatedAt: string;
  previewBoard: { tiles: string[][] };
  previewUnits: Array<{ x: number; y: number; side: "player" | "enemy" }>;
}

export interface GameRow {
  id: string;
  user_id: string;
  difficulty: string;
  status: GameStatus;
  board: { tiles: string[][] } | Board;
  units: Unit[] | unknown[];
  turn_number: number;
  ai_last_error: string | null;
  used_fallback: boolean;
  moves_applied: boolean;
  last_ai_actions: AiActionDto[] | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function iso(ts: Date | string): string {
  return ts instanceof Date ? ts.toISOString() : new Date(ts).toISOString();
}

export function toGameState(row: GameRow): GameStateDto {
  return {
    id: row.id,
    difficulty: row.difficulty,
    status: row.status,
    turnNumber: row.turn_number,
    board: row.board as { tiles: string[][] },
    units: (row.units as Unit[]).map((u) => ({
      id: u.id,
      side: u.side,
      class: u.class,
      x: u.x,
      y: u.y,
      hp: u.hp,
      maxHp: u.maxHp,
      acted: u.acted,
    })),
    lastAiActions: (row.last_ai_actions as AiActionDto[] | null) ?? null,
    updatedAt: iso(row.updated_at),
  };
}

export function toGameSummary(row: GameRow): GameSummaryDto {
  const units = (row.units as Unit[]) ?? [];
  return {
    id: row.id,
    difficulty: row.difficulty,
    status: row.status,
    turnNumber: row.turn_number,
    updatedAt: iso(row.updated_at),
    previewBoard: row.board as { tiles: string[][] },
    previewUnits: units.map((u) => ({ x: u.x, y: u.y, side: u.side })),
  };
}
