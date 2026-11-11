import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { registerViaUi, uniqueUser } from "../helpers/session";
import { createGame, getGame, getStats } from "../helpers/api";
import { playUntilWin } from "../helpers/play-bot";

// Stats reflects win/loss (09 Phase-7): a full victory played through the
// contract endpoints (see play-bot for the why) + a UI forfeit — both then
// visible on the Statistics tab.

async function createGameViaUi(page: Page, personaId: string): Promise<string> {
  await page.getByTestId("new-game").first().click();
  await expect(page.getByRole("dialog", { name: "New battle" })).toBeVisible();
  await page.getByTestId(`persona-${personaId}`).click();
  // The strip stays put (async creation). A won battle already sits in the
  // "Past battles" row — the NEW card is the one whose badge is live.
  const card = page.locator(".strip-card").filter({ hasText: "Your turn" });
  await expect(card).toHaveCount(1);
  await expect(card.locator(".status-badge")).toHaveText("Your turn");
  await card.click();
  await page.waitForURL(/\/play\/[0-9a-f-]{36}$/);
  return page.url().split("/play/")[1] ?? "";
}

test("stats reflect a won battle and a forfeited loss", async ({ page }) => {
  test.slow(); // the victory battle takes minutes of real game rounds
  const user = uniqueUser();
  await registerViaUi(page, user);

  // 1) WIN — the play-bot drives endpoints 12/13/14 until the engine's own
  // victory short-circuit fires against the standalone mock AI (04).
  const won = await createGame(page.request, "aggressive");
  const result = await playUntilWin(page.request, won.id);
  expect(result.game.status).toBe("won");

  // The board screen shows the victory overlay straight from the server
  // state (05: the finished game keeps being readable).
  await page.goto(`/play/${won.id}`);
  await expect(page.getByRole("dialog", { name: "Victory" })).toBeVisible();

  // Statistics tab reflects the win.
  await page.goto("/stats");
  const statBig = page.locator(".stat-big");
  await expect(statBig.nth(0).locator(".stat-number")).toHaveText("1");
  await expect(statBig.nth(1).locator(".stat-number")).toHaveText("100%");
  await expect(statBig.nth(2).locator(".stat-number")).toHaveText("1");
  await expect(statBig.nth(3).locator(".stat-number")).toHaveText("0");
  const aggroRow = page.locator("tr", { hasText: "Aggressive" });
  await expect(aggroRow).toBeVisible();

  // 2) LOSS — forfeit from the board screen (TurnFooter path, 05).
  await page.goto("/play");
  const lost = await createGameViaUi(page, "defensive");
  await page.getByTestId("forfeit").click();
  await expect(page.getByRole("dialog")).toContainText("Forfeit this battle?");
  await page.getByRole("button", { name: "Forfeit" }).last().click();
  await expect(page.getByRole("dialog", { name: "Defeat" })).toBeVisible();
  expect((await getGame(page.request, lost)).status).toBe("lost");

  // 3) Statistics reflect the full win/loss record.
  await page.goto("/stats");
  const statCards = page.locator(".stat-big");
  await expect(statCards.nth(0).locator(".stat-number")).toHaveText("2");
  await expect(statCards.nth(1).locator(".stat-number")).toHaveText("50%");
  await expect(statCards.nth(2).locator(".stat-number")).toHaveText("1");
  await expect(statCards.nth(3).locator(".stat-number")).toHaveText("1");
  // Per-difficulty table keeps stable rows for both personas.
  await expect(page.locator("tr", { hasText: "Aggressive" }).getByRole("cell")).toHaveText([
    "Aggressive",
    "1",
    "1",
    "0",
  ]);
  await expect(page.locator("tr", { hasText: "Defensive" }).getByRole("cell")).toHaveText([
    "Defensive",
    "1",
    "0",
    "1",
  ]);
  // Cross-check the authoritative endpoint as well.
  const stats = await getStats(page.request);
  expect(stats.gamesPlayed).toBe(2);
  expect(stats.wins).toBe(1);
  expect(stats.losses).toBe(1);
  expect(stats.winRate).toBeCloseTo(0.5);
});
