// DTO types transcribed from docs/06-api-contract.md — that file is the source
// of truth for these shapes; the server already validates against it.

export type ClassKey = "sword" | "axe" | "spear" | "archer" | "mage" | "healer";

export type Side = "player" | "enemy";

export type GameStatus = "player_turn" | "ai_turn" | "won" | "lost";

// user, as returned everywhere
export interface User {
  id: string;
  email: string;
  username: string;
  theme: string;
  createdAt: string;
}

// board
export interface Board {
  tiles: string[][];
} // 15x15, tile codes: "plain" | "forest" | "hill" | "lake" | "rock" | "river" | "bridge"

export type XY = [number, number];

// unit
export interface Unit {
  id: string; // "<P|E>-<class>-<n>" (per 03's spawn): stable for the game's life — NOT a uuid
  side: Side;
  class: ClassKey;
  x: number;
  y: number; // current position
  hp: number;
  maxHp: number;
  acted: boolean; // true once moved+acted this turn
}

export interface AiOutcome {
  targetId: string;
  damage: number; // damage dealt to the target (heal: amount healed)
  targetHp: number; // target's hp after the hit
  targetDied: boolean;
  counter: { damage: number; attackerHp: number } | null;
}

// enemy's last produced turn (for board animation); actions in execution order
export interface AiAction {
  unitId: string;
  path: XY[]; // starts at origin, ends on final tile
  action:
    | { type: "attack"; targetId: string }
    | { type: "heal"; targetId: string }
    | { type: "wait" };
  outcome: AiOutcome | null;
}

// one element of the POST /moves bundle (06 endpoint 13)
export type MoveAction =
  | { type: "attack"; targetId: string }
  | { type: "heal"; targetId: string }
  | { type: "wait" };

export interface MoveSubmission {
  unitId: string;
  path: XY[];
  action: MoveAction;
}

// full game state, as returned by game endpoints
export interface GameState {
  id: string;
  difficulty: string;
  status: GameStatus;
  turnNumber: number;
  board: Board;
  units: Unit[];
  lastAiActions: AiAction[] | null; // set after an AI turn applies; null at creation
  updatedAt: string;
}

// games-list item — `previewBoard` exists ONLY for the strip cards' mini-maps
// (06): a projection of the row's board JSON, never extra storage.
export interface GameSummary {
  id: string;
  difficulty: string;
  status: GameStatus;
  turnNumber: number;
  updatedAt: string;
  previewBoard: Board;
}

// GET /api/games/:id/preview/:unitId (06 endpoint 12) — tiles only, plus the
// side that tells the client which mode to render (staging vs inspection).
export interface PreviewResponse {
  moveTiles: XY[];
  attackTiles: XY[];
  healTiles: XY[];
  side: Side;
}

// GET /api/meta (06 endpoint 7) — public config subset
export interface ClassMeta {
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

export interface MetaResponse {
  boardSize: number;
  maxActiveGames: number;
  classes: Record<ClassKey, ClassMeta>;
  personalities: Record<string, { label: string }>;
  themes: { id: string; label: string }[];
  lore: Record<ClassKey, string>;
}

// GET /api/stats (06 endpoint 8)
export interface StatsResponse {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  byDifficulty: {
    difficulty: string;
    played: number;
    wins: number;
    losses: number;
  }[];
}
