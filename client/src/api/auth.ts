import type { User } from "../types";
import { request } from "./request";

export function register(input: {
  email: string;
  password: string;
  username: string;
}): Promise<{ user: User }> {
  return request<{ user: User }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(input: { email: string; password: string }): Promise<{ user: User }> {
  return request<{ user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function logout(): Promise<void> {
  await request<void>("/api/auth/logout", { method: "POST" });
}

export function me(options?: { suppressAuthRedirect?: boolean }): Promise<{ user: User }> {
  return request<{ user: User }>("/api/me", {
    method: "GET",
    suppressAuthRedirect: options?.suppressAuthRedirect,
  });
}

export function updateMe(input: { username?: string; theme?: string }): Promise<{ user: User }> {
  return request<{ user: User }>("/api/me", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await request<void>("/api/me/password", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}
