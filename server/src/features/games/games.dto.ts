// Shared game DTOs exactly as docs/06 declares them (server-side mirror).
import type { Board, Unit } from "../../game/types";

// enemy's last produced turn (for board animation); actions in execution order
export interface AiAction {
  unitId: string;
  path: Array<[number, number]>; // starts at origin, ends on final tile
  action:
    | { type: "attack"; targetId: string }
    | { type: "heal"; targetId: string }
    | { type: "wait" };
  outcome: {
    targetId: string;
    damage: number; // damage dealt to the target (heal: amount healed)
    targetHp: number; // target's hp after the hit
    targetDied: boolean;
    counter: { damage: number; attackerHp: number } | null;
  } | null;
}

// full game state, as returned by game endpoints
export interface GameStateDto {
  id: string;
  difficulty: string;
  status: "player_turn" | "ai_turn" | "won" | "lost";
  turnNumber: number;
  board: Board;
  units: Unit[];
  lastAiActions: AiAction[] | null; // null at creation
  updatedAt: string;
}
