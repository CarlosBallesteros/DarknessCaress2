const BASE = "/api/auth";

export async function login(body: { email: string; password: string }) {
  return fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
}

export async function logout() {
  return fetch(`${BASE}/logout`, { method: "POST", credentials: "include" });
}

export async function me() {
  return fetch(`${BASE}/me`, { credentials: "include" });
}
