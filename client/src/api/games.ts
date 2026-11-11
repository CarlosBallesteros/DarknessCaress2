import type { GameState, GameSummary, MoveSubmission, PreviewResponse } from "../types/api";
import { request } from "./request";

// Games group (06 endpoints 9–15). A 401 here means the session expired while
// the user was playing — the wrapper's app-wide redirect applies.
export async function listGames(): Promise<GameSummary[]> {
  const { games } = await request<{ games: GameSummary[] }>("/api/games");
  return games;
}

export async function createGame(difficulty: string): Promise<GameState> {
  const { game } = await request<{ game: GameState }>("/api/games", {
    method: "POST",
    body: { difficulty },
  });
  return game;
}

export async function getGame(id: string): Promise<GameState> {
  const { game } = await request<{ game: GameState }>(`/api/games/${id}`);
  return game;
}

export async function getPreview(gameId: string, unitId: string): Promise<PreviewResponse> {
  return request<PreviewResponse>(`/api/games/${gameId}/preview/${unitId}`);
}

export async function postMoves(gameId: string, moves: MoveSubmission[]): Promise<GameState> {
  const { game } = await request<{ game: GameState }>(`/api/games/${gameId}/moves`, {
    method: "POST",
    body: { moves },
  });
  return game;
}

export async function endTurn(gameId: string): Promise<GameState> {
  const { game } = await request<{ game: GameState }>(`/api/games/${gameId}/end-turn`, {
    method: "POST",
  });
  return game;
}

export async function forfeit(gameId: string): Promise<GameState> {
  const { game } = await request<{ game: GameState }>(`/api/games/${gameId}/forfeit`, {
    method: "POST",
  });
  return game;
}
