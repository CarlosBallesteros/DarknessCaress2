import { test, expect } from "@playwright/test";
import { loginViaUi, registerViaUi, uniqueUser } from "../helpers/session";

// Auth flows from 09 Phase-7: register, login (bad + good), logout/login.

test("register flow lands on /play with the new account", async ({ page }) => {
  const user = uniqueUser();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Darkness Caress II");
  await expect(page.getByText("The long-awaited sequel to the legendary game")).toBeVisible();
  await page.getByTestId("play").click();
  await page.waitForURL("**/login");

  await page.getByRole("link", { name: "Register" }).click();
  await page.waitForURL("**/register");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByLabel("Password again").fill(user.password);
  await page.getByRole("button", { name: "Register" }).click();

  await page.waitForURL("**/play");
  await expect(page.getByRole("heading", { name: "Your battles" })).toBeVisible();
  await expect(page.locator(".menu-username")).toHaveText(user.username);
  await expect(page.getByTestId("tab-game")).toBeVisible();
});

test("login rejects a bad password and accepts a good one", async ({ page }) => {
  const user = uniqueUser();
  await registerViaUi(page, user);
  await page.getByTestId("logout").click();
  await page.waitForURL("http://*/");
  await expect(page.getByTestId("play")).toBeVisible(); // logged out ⇒ landing

  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password");

  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL("**/play");
  await expect(page.locator(".menu-username")).toHaveText(user.username);
});

test("logout clears the session; login comes back", async ({ page }) => {
  const user = uniqueUser();
  await registerViaUi(page, user);
  await loginViaUi(page, user); // already logged in — proves a repeat login works

  await page.getByTestId("logout").click();
  await page.waitForURL("http://*/");
  await expect(page.getByTestId("play")).toBeVisible();

  await loginViaUi(page, user);
  await expect(page.locator(".menu-username")).toHaveText(user.username);
});
