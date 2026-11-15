import type { User } from "../types";
import { request } from "./request";

export function register(body: {
  email: string;
  password: string;
  username: string;
}): Promise<{ user: User }> {
  return request<{ user: User }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function login(body: { email: string; password: string }): Promise<{ user: User }> {
  return request<{ user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export function me(opts: { suppressUnauthorized?: boolean } = {}): Promise<{ user: User }> {
  return request<{ user: User }>("/api/me", {
    suppressUnauthorized: opts.suppressUnauthorized ?? true,
  });
}

export function patchMe(body: { username?: string; theme?: string }): Promise<{ user: User }> {
  return request<{ user: User }>("/api/me", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function changePassword(body: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  return request<void>("/api/me/password", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}
