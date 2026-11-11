import type { APIRequestContext } from "@playwright/test";

/**
 * Narrow DTO mirrors of docs/06 — only the fields the suite reads. The
 * contract itself is owned by docs/06 and the client/server types; these are
 * test-local transcriptions for the harness, never a second source of truth.
 */
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

export interface GameState {
  id: string;
  difficulty: string;
  status: "generating_board" | "player_turn" | "ai_turn" | "won" | "lost";
  turnNumber: number;
  board: { tiles: string[][] };
  units: Unit[];
  lastAiActions: Array<{
    unitId: string;
    path: Array<[number, number]>;
  }> | null;
  updatedAt: string;
}

export interface GameSummary {
  id: string;
  difficulty: string;
  status: GameState["status"];
  turnNumber: number;
  updatedAt: string;
}

export interface Preview {
  moveTiles: Array<[number, number]>;
  attackTiles: Array<[number, number]>;
  healTiles: Array<[number, number]>;
}

export interface ClassMeta {
  label: string;
  hp: number;
  atk: number;
  def: number;
  mov: number;
  range: number[];
  healAmount?: number;
}

export interface Meta {
  boardSize: number;
  classes: Record<string, ClassMeta>;
}

export interface Stats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  byDifficulty: Array<{ difficulty: string; played: number; wins: number; losses: number }>;
}

export interface Move {
  unitId: string;
  path: Array<[number, number]>;
  action:
    { type: "attack"; targetId: string } | { type: "heal"; targetId: string } | { type: "wait" };
}

/** Throws with body context unless the status matches expectations. */
async function unwrap<T>(response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  if (!response.ok()) {
    throw new Error(`API ${response.status()} on ${response.url()}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export async function getGame(api: APIRequestContext, gameId: string): Promise<GameState> {
  return unwrap<{ game: GameState }>(await api.get(`/api/games/${gameId}`)).then(
    (body) => body.game,
  );
}

export async function listGames(api: APIRequestContext): Promise<GameSummary[]> {
  return unwrap<{ games: GameSummary[] }>(await api.get("/api/games")).then((body) => body.games);
}

export async function getMeta(api: APIRequestContext): Promise<Meta> {
  return unwrap<Meta>(await api.get("/api/meta"));
}

export async function getStats(api: APIRequestContext): Promise<Stats> {
  return unwrap<Stats>(await api.get("/api/stats"));
}

/**
 * Endpoint 10's async creation, asserted at the CONTRACT level: 202 (not
 * 200/201) with the game in `generating_board` — the board-design job runs
 * fire-and-forget after the response, so the 202 body is deterministic.
 */
export async function createGameExpecting202(
  api: APIRequestContext,
  difficulty: string,
): Promise<GameState> {
  const response = await api.post("/api/games", {
    data: { difficulty },
    timeout: 90_000,
  });
  if (response.status() !== 202) {
    throw new Error(
      `POST /api/games answered ${response.status()} (expected 202): ${await response.text()}`,
    );
  }
  return ((await response.json()) as { game: GameState }).game;
}

export async function createGame(api: APIRequestContext, difficulty: string): Promise<GameState> {
  const response = await api.post("/api/games", {
    data: { difficulty },
    timeout: 90_000,
  });
  return unwrap<{ game: GameState }>(response).then((body) => body.game);
}

export async function getPreview(
  api: APIRequestContext,
  gameId: string,
  unitId: string,
): Promise<Preview> {
  return unwrap<Preview>(await api.get(`/api/games/${gameId}/preview/${unitId}`));
}

export async function postMoves(
  api: APIRequestContext,
  gameId: string,
  moves: Move[],
): Promise<GameState> {
  const response = await api.post(`/api/games/${gameId}/moves`, {
    data: { moves },
  });
  return unwrap<{ game: GameState }>(response).then((body) => body.game);
}

export async function endTurn(api: APIRequestContext, gameId: string): Promise<GameState> {
  const response = await api.post(`/api/games/${gameId}/end-turn`);
  return unwrap<{ game: GameState }>(response).then((body) => body.game);
}

export async function register(
  api: APIRequestContext,
  creds: { email: string; password: string; username: string },
): Promise<void> {
  const response = await api.post("/api/auth/register", { data: creds });
  if (!response.ok()) {
    throw new Error(`register failed: ${await response.text()}`);
  }
}
