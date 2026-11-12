import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");

function composeCmd(sql: string): string {
  const escaped = sql.replace(/"/g, '\\"');
  return `docker compose -f docker-compose.yml -f docker-compose.override.yml -f e2e/docker-compose.e2e.yml exec -T db psql -U dc -d darknesscaress -v ON_ERROR_STOP=1 -c "${escaped}"`;
}

function dbExec(sql: string): string {
  return execSync(composeCmd(sql), {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function register(
  page: Page,
  email: string,
  username: string,
  password: string,
): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Password again").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/play$/);
}

async function logout(page: Page): Promise<void> {
  await page.getByTestId("logout").click();
  await expect(page).toHaveURL(/\/$/);
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

test.describe.serial("phase 7 local e2e flow", () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const email = `e2e_${suffix}@example.com`;
  const username = `user_${suffix}`.slice(0, 20);
  const password = "correct-horse-battery";
  let userId = "";

  test("register flow", async ({ page }) => {
    await register(page, email, username, password);
    await expect(page.getByTestId("new-game")).toBeVisible();
  });

  test("logout/login bad + good", async ({ page }) => {
    await register(page, `tmp_${suffix}@example.com`, `tmp_${suffix}`.slice(0, 20), password);
    await logout(page);

    await page.goto("/login");
    await page.getByLabel("Email").fill(`tmp_${suffix}@example.com`);
    await page.getByLabel("Password").fill("wrong-password-123");
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page.locator(".error-banner")).toContainText("Invalid email or password");

    await page.getByLabel("Email").fill(`tmp_${suffix}@example.com`);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL(/\/play$/);
    await expect(page.getByTestId("new-game")).toBeVisible();

    // capture user id for later stats seeding
    const meRes = await page.request.get("/api/me");
    expect(meRes.ok()).toBeTruthy();
    const meJson = (await meRes.json()) as { user: { id: string } };
    userId = meJson.user.id;

    await logout(page);
  });

  test("full local gameplay, forfeit, store, stats, logout/login", async ({ page }) => {
    // login as main seeded tmp user from previous test context is gone after logout; use that account
    await login(page, `tmp_${suffix}@example.com`, password);
    await expect(page).toHaveURL(/\/play$/);

    if (!userId) {
      const meRes = await page.request.get("/api/me");
      expect(meRes.ok()).toBeTruthy();
      const meJson = (await meRes.json()) as { user: { id: string } };
      userId = meJson.user.id;
    }

    // Store tab renders "Coming soon…"
    await page.getByTestId("tab-store").click();
    await expect(page).toHaveURL(/\/store$/);
    await expect(page.getByText(/Coming soon/i)).toBeVisible();
    await page.getByTestId("tab-game").click();
    await expect(page).toHaveURL(/\/play$/);

    // create game: 202 → "Being designed…" card state → resolves to player_turn
    await page.getByTestId("new-game").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByTestId("persona-aggressive").click();
    await expect(page.getByRole("dialog")).toBeHidden();

    const activeCard = page.locator(".strip-row .game-card.active").first();
    await expect(activeCard).toBeVisible({ timeout: 30_000 });
    await expect(activeCard).toContainText("Being designed");

    // wait for design to finish and card become playable
    await expect(activeCard).toContainText("Your turn", { timeout: 180_000 });
    const cardTestId = await activeCard.getAttribute("data-testid");
    expect(cardTestId).toBeTruthy();
    const gameId = (cardTestId as string).replace("game-card-", "");

    // open board while playable (and ensure board state resolves)
    await activeCard.locator(".card-focus").click();
    await expect(page).toHaveURL(new RegExp(`/play/${gameId}$`));
    await expect(page.locator(".phase-banner")).toBeVisible();
    await expect(page.locator(".phase-banner")).not.toContainText(
      "The battlefield is being designed",
      { timeout: 180_000 },
    );
    await expect(page.locator(".phase-banner")).toContainText(/Your turn|Turn/);

    // select unit, preview overlay, stage a move
    const playerUnit = page.locator('[data-testid^="unit-P-sword-"]').first();
    await expect(playerUnit).toBeVisible({ timeout: 30_000 });
    const unitBox = await playerUnit.boundingBox();
    expect(unitBox).toBeTruthy();
    await playerUnit.click();
    await expect(page.locator(".tile.ov-move").first()).toBeVisible({ timeout: 20_000 });

    // pick a move tile and stage wait in place
    await page.locator(".tile.ov-move").first().click();
    await expect(page.getByRole("button", { name: "Wait in place" })).toBeVisible();
    await page.getByRole("button", { name: "Wait in place" }).click();
    await expect(page.getByTestId("staged-chip-0")).toBeVisible();

    // end turn (accept confirm for unacted units)
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.getByTestId("end-turn").click();

    // mocked AI turn resolves + board updates
    await expect(page.locator(".phase-banner")).toContainText(/The darkness is thinking|AI/i, {
      timeout: 30_000,
    });
    await expect(page.locator(".phase-banner")).toContainText(/Your turn/i, { timeout: 180_000 });
    await expect(page.locator(".phase-banner")).toContainText(/Turn 2/);

    // forfeit path
    page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await page.locator("footer.turn-footer").getByTestId("forfeit").click();
    await expect(page.locator(".result-overlay")).toContainText("Defeat");
    await page.getByRole("button", { name: "Back to games" }).click();
    await expect(page).toHaveURL(/\/play$/);

    // seed one won game so stats reflect win/loss (finished outcomes); implemented via DB for deterministic coverage
    const insertSql = `INSERT INTO games (user_id, difficulty, status, board, units, turn_number) VALUES ('${userId}', 'aggressive', 'won', '{"tiles":[["plain","plain","plain","plain","plain","plain","plain","plain"],["plain","plain","plain","plain","plain","plain","plain","plain"],["plain","plain","plain","plain","plain","plain","plain","plain"],["plain","plain","plain","plain","plain","plain","plain","plain"],["plain","plain","plain","plain","plain","plain","plain","plain"],["plain","plain","plain","plain","plain","plain","plain","plain"],["plain","plain","plain","plain","plain","plain","plain","plain"],["plain","plain","plain","plain","plain","plain","plain","plain"]]}', '[]', 3);`;
    dbExec(insertSql);

    // stats reflect win/loss
    await page.goto("/stats");
    await expect(page.locator("body")).toContainText(/Games/i);
    const statsRes = await page.request.get("/api/stats");
    expect(statsRes.ok()).toBeTruthy();
    const stats = (await statsRes.json()) as { gamesPlayed: number; wins: number; losses: number };
    expect(stats.gamesPlayed).toBeGreaterThanOrEqual(2);
    expect(stats.wins).toBeGreaterThanOrEqual(1);
    expect(stats.losses).toBeGreaterThanOrEqual(1);
    await expect(page.locator("body")).toContainText(String(stats.gamesPlayed));

    // logout/login
    await logout(page);
    await login(page, `tmp_${suffix}@example.com`, password);
    await expect(page).toHaveURL(/\/play$/);
  });
});
