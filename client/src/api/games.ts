const BASE = "/api/games";

export async function listGames() {
  return fetch(`${BASE}`, { credentials: "include" });
}

export async function getGame(id: string) {
  return fetch(`${BASE}/${id}`, { credentials: "include" });
}

export async function createGame(body: { difficulty: string }) {
  return fetch(`${BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
}

export async function endTurn(id: string) {
  return fetch(`${BASE}/${id}/end-turn`, {
    method: "POST",
    credentials: "include",
  });
}
