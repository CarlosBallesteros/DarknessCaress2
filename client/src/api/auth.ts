import type { User } from "../types/api";
import { request } from "./request";

// Auth + profile group (06 endpoints 1–6). These endpoints handle their own
// 401s inline, so they skip the wrapper's app-wide redirect.
export async function register(input: {
  email: string;
  password: string;
  username: string;
}): Promise<User> {
  const { user } = await request<{ user: User }>("/api/auth/register", {
    method: "POST",
    body: input,
    skipAuthRedirect: true,
  });
  return user;
}

export async function login(email: string, password: string): Promise<User> {
  const { user } = await request<{ user: User }>("/api/auth/login", {
    method: "POST",
    body: { email, password },
    skipAuthRedirect: true,
  });
  return user;
}

export async function logout(): Promise<void> {
  await request<void>("/api/auth/logout", {
    method: "POST",
    skipAuthRedirect: true,
  });
}

export async function me(): Promise<User> {
  const { user } = await request<{ user: User }>("/api/me", {
    skipAuthRedirect: true,
  });
  return user;
}

export async function patchMe(patch: {
  username?: string;
  theme?: string;
}): Promise<User> {
  const { user } = await request<{ user: User }>("/api/me", {
    method: "PATCH",
    body: patch,
    skipAuthRedirect: true,
  });
  return user;
}

export async function patchPassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request<void>("/api/me/password", {
    method: "PATCH",
    body: { currentPassword, newPassword },
    skipAuthRedirect: true,
  });
}
