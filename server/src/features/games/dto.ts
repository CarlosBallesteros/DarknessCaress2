import type { Unit } from "../../game/types";

export type GameStatus = "generating_board" | "player_turn" | "ai_turn" | "won" | "lost";

export interface GameRow {
  id: string;
  user_id: string;
  difficulty: string;
  status: GameStatus;
  board: { tiles: string[][] };
  units: Unit[];
  turn_number: number;
  ai_last_error: string | null;
  used_fallback: boolean;
  moves_applied: boolean;
  last_ai_actions: unknown | null;
  created_at: Date;
  updated_at: Date;
}

export interface GameStateDto {
  id: string;
  difficulty: string;
  status: GameStatus;
  turnNumber: number;
  board: { tiles: string[][] };
  units: Unit[];
  lastAiActions: unknown | null;
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

export function toGameStateDto(row: GameRow): GameStateDto {
  return {
    id: row.id,
    difficulty: row.difficulty,
    status: row.status,
    turnNumber: row.turn_number,
    board: row.board,
    units: row.units,
    lastAiActions: row.last_ai_actions ?? null,
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toGameSummaryDto(row: GameRow): GameSummaryDto {
  return {
    id: row.id,
    difficulty: row.difficulty,
    status: row.status,
    turnNumber: row.turn_number,
    updatedAt: row.updated_at.toISOString(),
    previewBoard: row.board,
    previewUnits: (row.units ?? []).map((u) => ({ x: u.x, y: u.y, side: u.side })),
  };
}
