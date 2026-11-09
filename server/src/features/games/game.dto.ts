import type { Board, Unit } from "../../game/types.js";

/** A row of the games table, as pg returns it (snake_case columns). */
export interface GameRow {
  id: string;
  user_id: string;
  difficulty: string;
  status: "player_turn" | "ai_turn" | "won" | "lost";
  board: Board;
  units: Unit[];
  turn_number: number;
  ai_last_error: string | null;
  used_fallback: boolean;
  last_ai_actions: unknown;
  moves_applied: boolean;
  created_at: Date;
  updated_at: Date;
}

/** Full game state from 06-api-contract.md (used_fallback stays debug-only). */
export interface GameDTO {
  id: string;
  difficulty: string;
  status: GameRow["status"];
  turnNumber: number;
  board: Board;
  units: Unit[];
  lastAiActions: unknown;
  updatedAt: string;
}

/** One small mapping function per feature converts rows to 06's DTOs (01). */
export function toGameDTO(row: GameRow): GameDTO {
  return {
    id: row.id,
    difficulty: row.difficulty,
    status: row.status,
    turnNumber: row.turn_number,
    board: row.board,
    units: row.units,
    lastAiActions: row.last_ai_actions,
    updatedAt: row.updated_at.toISOString(),
  };
}

/** Games-list item from 06 (creation order; the client dims finished games). */
export interface GameSummaryDTO {
  id: string;
  difficulty: string;
  status: GameRow["status"];
  turnNumber: number;
  updatedAt: string;
}

export function toGameSummary(row: GameRow): GameSummaryDTO {
  return {
    id: row.id,
    difficulty: row.difficulty,
    status: row.status,
    turnNumber: row.turn_number,
    updatedAt: row.updated_at.toISOString(),
  };
}
