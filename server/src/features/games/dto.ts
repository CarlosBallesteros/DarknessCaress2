import type { Board, Unit } from "../../game/types.js";

export type GameStatus = "generating_board" | "player_turn" | "ai_turn" | "won" | "lost";

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
  lastAiActions: unknown[] | null;
  updatedAt: string;
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
  last_ai_actions: unknown[] | null;
  created_at: Date | string;
  updated_at: Date | string;
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
    lastAiActions: row.last_ai_actions ?? null,
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : new Date(row.updated_at).toISOString(),
  };
}
