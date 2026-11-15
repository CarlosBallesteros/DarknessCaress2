import type { GameState, GameSummary, PreviewResponse, MovePayload, Stats } from "../types";
import { request } from "./request";

export function listGames(): Promise<{ games: GameSummary[] }> {
  return request<{ games: GameSummary[] }>("/api/games");
}

export function createGame(body: { difficulty: string }): Promise<{ game: GameState }> {
  return request<{ game: GameState }>("/api/games", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function getGame(id: string): Promise<{ game: GameState }> {
  return request<{ game: GameState }>(`/api/games/${id}`);
}

export function previewUnit(gameId: string, unitId: string): Promise<PreviewResponse> {
  return request<PreviewResponse>(`/api/games/${gameId}/preview/${unitId}`);
}

export function submitMoves(
  gameId: string,
  body: { moves: MovePayload[] },
): Promise<{ game: GameState }> {
  return request<{ game: GameState }>(`/api/games/${gameId}/moves`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function endTurn(gameId: string): Promise<{ game: GameState }> {
  return request<{ game: GameState }>(`/api/games/${gameId}/end-turn`, {
    method: "POST",
  });
}

export function forfeitGame(gameId: string): Promise<{ game: GameState }> {
  return request<{ game: GameState }>(`/api/games/${gameId}/forfeit`, {
    method: "POST",
  });
}

export function getStats(): Promise<Stats> {
  return request<Stats>("/api/stats");
}
