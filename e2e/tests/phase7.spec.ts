import { expect, test, type Page } from "@playwright/test";

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function register(page: Page, email: string, username: string, password: string) {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Password again").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/play$/);
}

async function logout(page: Page) {
  await page.getByTestId("logout").click();
  await expect(page).toHaveURL(/\/$/);
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

async function createGameAndWaitForPlayerTurn(page: Page, personaTestId: string) {
  await page.goto("/play");
  await page.getByTestId("new-game").click();
  await page.getByTestId(personaTestId).click();
  await expect(page.locator(".modal")).toHaveCount(0);

  // A card should appear; it may briefly be "Being designed…" under fast/mock generation
  // or already resolved to "Your turn". Accept either, but ensure it resolves to player_turn.
  const cards = page.locator('[data-testid^="game-card-"]');
  await expect(cards.first()).toBeVisible({ timeout: 30_000 });

  // Check for generating state when observable on the newest active card(s)
  const designing = page.getByText("Being designed…");
  const yourTurn = page.locator(".game-card .status-badge", { hasText: "Your turn" }).first();
  const designingVisible = await designing
    .first()
    .waitFor({ state: "visible", timeout: 1500 })
    .then(() => true)
    .catch(() => false);

  if (designingVisible) {
    // observable generating state -> must resolve to player_turn
    await expect(yourTurn).toBeVisible({ timeout: 30_000 });
  } else {
    // otherwise already resolved
    await expect(yourTurn).toBeVisible({ timeout: 30_000 });
  }

  const cardId = await cards.first().getAttribute("data-testid");
  if (!cardId) throw new Error("missing game card testid");
  const gameId = cardId.replace("game-card-", "");
  return gameId;
}

async function openGameFromStrip(page: Page, gameId: string) {
  await page.goto("/play");
  const card = page.getByTestId(`game-card-${gameId}`);
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.click();
  await expect(page).toHaveURL(new RegExp(`/play/${gameId}$`));
}

async function stageOneMove(page: Page) {
  // Select a player unit (from tray chips or board). Tray chips for selectable units are enabled.
  const trayChip = page.locator(".unit-tray .tray-chip:not([disabled])").first();
  await expect(trayChip).toBeVisible({ timeout: 30_000 });
  await trayChip.click();

  // Preview overlay should show reachable move tiles
  const moveTile = page.locator(".board-tile.ov-move").first();
  await expect(moveTile).toBeVisible({ timeout: 20_000 });

  await moveTile.click();

  // Move picked -> Wait/Cancel actions appear
  const waitButton = page.getByRole("button", { name: "Wait", exact: true });
  await expect(waitButton).toBeVisible({ timeout: 20_000 });
  await waitButton.click();

  await expect(page.getByTestId("staged-chip-0")).toBeVisible({ timeout: 20_000 });
}

async function endTurnAndWaitForAiResolution(page: Page) {
  const turnText = page.locator(".phase-banner span", { hasText: /^Turn \d+$/ }).first();
  await expect(turnText).toBeVisible();
  const before = (await turnText.innerText()).trim();
  const beforeNum = Number(before.replace(/[^0-9]/g, ""));

  await page.getByTestId("end-turn").click();

  // Confirm dialog appears when un-acted units remain
  const confirm = page.getByRole("dialog", { name: /\d+ unit\(s\) have not acted/ });
  if (await confirm.isVisible({ timeout: 2000 }).catch(() => false)) {
    await confirm.getByRole("button", { name: "End turn", exact: true }).click();
  }

  // AI turn should resolve (mocked/policy) and board return to player turn with turn advanced
  await expect(page.locator(".phase-status")).toContainText(/Your turn|Victory|Defeat/, {
    timeout: 60_000,
  });
  await expect
    .poll(async () => (await turnText.innerText()).trim(), { timeout: 60_000 })
    .not.toBe(before);
  const after = (await turnText.innerText()).trim();
  const afterNum = Number(after.replace(/[^0-9]/g, ""));
  // on success to player_turn, turn increments; on loss it may also change state - just ensure update happened
  expect(afterNum === beforeNum + 1 || after.includes("1") || after !== before).toBeTruthy();
}

test.describe.serial("Phase 7 local E2E (composed stack, LLM_MOCK=1)", () => {
  const suffix = uniqueSuffix();
  const email = `player-${suffix}@example.com`;
  const username = `user_${suffix.slice(-8).replace(/[^a-zA-Z0-9_-]/g, "a")}`;
  const password = "correct-horse";

  test("register, logout/login, store, create+play+ai+stats/forfeit flow", async ({ page }) => {
    // Register flow
    await register(page, email, username, password);

    // logout
    await logout(page);

    // login (bad)
    await login(page, email, "wrong-password-123");
    await expect(page.locator(".error-banner")).toContainText("Invalid email or password");
    await expect(page).toHaveURL(/\/login/);

    // login (good)
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/play$/);

    // Store tab renders "Coming soon…"
    await page.getByTestId("tab-store").click();
    await expect(page).toHaveURL(/\/store$/);
    await expect(page.getByText("Coming soon…")).toBeVisible();

    // Create game (observable generating state or already resolved) -> resolves to player_turn
    const gameId = await createGameAndWaitForPlayerTurn(page, "persona-aggressive");

    // Open board and handle possible generating_board state there as well
    await openGameFromStrip(page, gameId);
    const generatingBanner = page.getByText("The battlefield is being designed…");
    if (await generatingBanner.isVisible({ timeout: 1500 }).catch(() => false)) {
      await expect(page.getByText("Your turn")).toBeVisible({ timeout: 30_000 });
    }
    await expect(page.locator(".phase-status")).toContainText(
      /Your turn|The battlefield is being designed…/,
    );

    // Ensure player_turn before interacting
    await expect(page.locator(".phase-status")).toContainText("Your turn", { timeout: 30_000 });

    // Select unit, preview overlay, stage a move
    await stageOneMove(page);

    // End turn -> mocked/policy AI turn resolves + board updates
    await endTurnAndWaitForAiResolution(page);

    // Forfeit path: forfeit current game from board
    await page.getByTestId("forfeit").click();
    const forfeitDialog = page.getByRole("dialog", { name: "Forfeit battle?" });
    await expect(forfeitDialog).toBeVisible();
    await forfeitDialog.getByRole("button", { name: "Forfeit", exact: true }).click();
    await expect(page.locator(".result-card h2")).toContainText("Defeat");

    // Stats reflect win/loss (forfeit produces a loss)
    await page.goto("/stats");
    await expect(page.locator(".stats-totals, .stats-empty")).toBeVisible({ timeout: 30_000 });
    // after at least one finished (lost) game, totals should be shown (not empty state)
    await expect(page.locator(".stats-totals")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".stats-totals")).toContainText(/Games played/i);
    await expect(page.locator(".stats-totals")).toContainText(/Losses/i);
    await expect(page.locator(".stats-totals")).toContainText(/Wins/i);
    await expect(page.locator(".stats-table")).toBeVisible();

    // logout/login (end) - logout then login good again
    await logout(page);
    await login(page, email, password);
    await expect(page).toHaveURL(/\/play$/);
    await expect(page.getByTestId("logout")).toBeVisible();
  });
});
