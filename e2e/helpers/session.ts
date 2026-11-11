import type { Page } from "@playwright/test";

/**
 * Per-test unique credentials (citext-unique across the shared dev DB —
 * every rerun registers a fresh user, so no state leaks between suites).
 */
export interface TestUser {
  email: string;
  username: string;
  password: string;
}

export function uniqueUser(): TestUser {
  const stamp = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  return {
    email: `e2e-${stamp}@dc.test`,
    username: `e2e-${stamp}`, // 3–20 chars, [a-zA-Z0-9_-]
    password: `pass-${stamp}-12`,
  };
}

/** Registers through the real UI and lands on /play. */
export async function registerViaUi(page: Page, user: TestUser): Promise<void> {
  await page.goto("/");
  await page.getByTestId("play");
  await page.goto("/register");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Password again").fill(user.password);
  await page.getByRole("button", { name: "Register" }).click();
  await page.waitForURL("**/play");
}

/** Logs in through the real UI and lands on the saved back-link (/play). */
export async function loginViaUi(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/play");
}
