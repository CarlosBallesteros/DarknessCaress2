import { randomUUID } from "node:crypto";

export function uniqueEmail(): string {
  return `user-${randomUUID()}@test.example`;
}

export function uniqueUsername(): string {
  return `u${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
