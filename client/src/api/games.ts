import type { GameState, GameSummary, MoveBundle, PreviewResponse } from "../types";
import { request } from "./request";

export function listGames(): Promise<{ games: GameSummary[] }> {
  return request<{ games: GameSummary[] }>("/api/games");
}

export function createGame(input: { difficulty: string }): Promise<{ game: GameState }> {
  return request<{ game: GameState }>("/api/games", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getGame(id: string): Promise<{ game: GameState }> {
  return request<{ game: GameState }>(`/api/games/${encodeURIComponent(id)}`);
}

export function getPreview(gameId: string, unitId: string): Promise<PreviewResponse> {
  return request<PreviewResponse>(
    `/api/games/${encodeURIComponent(gameId)}/preview/${encodeURIComponent(unitId)}`,
  );
}

export function submitMoves(gameId: string, moves: MoveBundle[]): Promise<{ game: GameState }> {
  return request<{ game: GameState }>(`/api/games/${encodeURIComponent(gameId)}/moves`, {
    method: "POST",
    body: JSON.stringify({ moves }),
  });
}

export function endTurn(gameId: string): Promise<{ game: GameState }> {
  return request<{ game: GameState }>(`/api/games/${encodeURIComponent(gameId)}/end-turn`, {
    method: "POST",
  });
}

export function forfeitGame(gameId: string): Promise<{ game: GameState }> {
  return request<{ game: GameState }>(`/api/games/${encodeURIComponent(gameId)}/forfeit`, {
    method: "POST",
  });
}
