import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { registerViaUi, uniqueUser } from "../helpers/session";
import { createGameExpecting202, getGame } from "../helpers/api";
import type { GameState } from "../helpers/api";

// Board flows from 09 Phase-7: create game (async 202 flow), select unit,
// preview overlay, stage a move, submit, end turn, mocked AI turn resolves
// + board updates.

/**
 * Creates a game through the strip's New battle action and opens its board
 * once the design job resolved. The v3 strip stays on /play after the 202
 * (async creation, docs/05): the card joins the Active row and the strip's
 * 3 s polling brings it to life in place.
 */
async function createGameViaUi(page: Page, personaId = "aggressive"): Promise<string> {
  // The strip's always-visible header action; on an empty strip a second
  // copy renders in the empty state (05) — either opens the modal.
  await page.getByTestId("new-game").first().click();
  await expect(page.getByRole("dialog", { name: "New battle" })).toBeVisible();
  await page.getByTestId(`persona-${personaId}`).click();
  // Exactly one battle on a fresh strip: its card joins the Active row.
  const card = page.locator(".strip-card");
  await expect(card).toHaveCount(1);
  // The card is caught either mid-design ("Being designed…" pulse) or, if
  // the mock job already won the race against the refresh, already live —
  // either way it resolves to the player's turn (docs/05's badge set).
  const badge = card.locator(".status-badge");
  await expect(badge).toHaveText(/^(Being designed…|Your turn)$/);
  await expect(badge).toHaveText("Your turn");
  await card.click();
  await page.waitForURL(/\/play\/[0-9a-f-]{36}$/);
  return page.url().split("/play/")[1] ?? "";
}

/** Units whose tile changed between two snapshots. */
function movedUnits(
  before: GameState,
  after: GameState,
): Array<{ id: string; x: number; y: number }> {
  return after.units
    .map((unit) => {
      const old = before.units.find((u) => u.id === unit.id);
      if (old === undefined || (old.x === unit.x && old.y === unit.y)) {
        return null;
      }
      return { id: unit.id, x: unit.x, y: unit.y };
    })
    .filter((u): u is { id: string; x: number; y: number } => u !== null);
}

test.describe("board flow", () => {
  let user: ReturnType<typeof uniqueUser>;

  test.beforeEach(async ({ page }) => {
    user = uniqueUser();
    await registerViaUi(page, user);
  });

  test("async creation: 202 placeholder state resolves to a designed board", async ({ page }) => {
    // Endpoint 10's contract (06): 202 immediately, the row inserts as
    // generating_board with an all-plain placeholder board and empty armies;
    // the background job designs the battlefield (mock brief per 04).
    const created = await createGameExpecting202(page.request, "aggressive");
    expect(created.status).toBe("generating_board");
    expect(created.turnNumber).toBe(1);
    expect(created.board.tiles).toHaveLength(15);
    for (const row of created.board.tiles) {
      expect(row).toHaveLength(15);
      for (const tile of row) {
        expect(tile).toBe("plain");
      }
    }
    expect(created.units).toHaveLength(0);

    // The design job flips the row to player_turn (poll = the client's own
    // convergence path, 3 s floor).
    const deadline = Date.now() + 15_000;
    let game = created;
    while (game.status === "generating_board") {
      expect(Date.now()).toBeLessThan(deadline);
      await page.waitForTimeout(300);
      game = await getGame(page.request, created.id);
    }
    expect(game.status).toBe("player_turn");
    expect(game.units).toHaveLength(20); // 10 + 10 armies (00)
  });

  test("create game via the strip: card comes alive in place, board shows both armies", async ({
    page,
  }) => {
    await createGameViaUi(page);
    await expect(page.getByTestId("board")).toBeVisible();
    // Both armies spawn whole: 10 + 10 sprites (00).
    for (const side of ["player", "enemy"]) {
      expect(await page.locator(`.unit-${side}`).count()).toBe(10);
    }
    await expect(page.locator(".phase-banner")).toContainText("Turn 1");
    await expect(page.locator(".phase-banner")).toContainText("Your turn");
  });

  test("select unit draws the preview overlay", async ({ page }) => {
    await createGameViaUi(page);
    await page.getByTestId("unit-P-sword-1").click();
    // Selected ring + the reachable-tile overlay (05).
    await expect(page.getByTestId("unit-P-sword-1")).toHaveClass(/unit-selected/);
    await expect(page.locator(".tile-move").first()).toBeVisible();
    expect(await page.locator(".tile-move").count()).toBeGreaterThan(0);
    // ActionPanel prompts for a destination once a unit is selected (05).
    await expect(page.locator(".action-panel")).toContainText("Pick a destination tile.");
  });

  test("stage a move, submit, end turn — mocked AI resolves, board updates", async ({ page }) => {
    const gameId = await createGameViaUi(page);

    const before = await getGame(page.request, gameId);
    expect(before.status).toBe("player_turn");

    // Select a fast unit and march it one reachable tile.
    await page.getByTestId("unit-P-spear-1").click();
    const reachable = page.locator(".tile-move");
    await expect(reachable.first()).toBeVisible();
    expect(await reachable.count()).toBeGreaterThan(0);
    await reachable.first().click();
    await expect(page.locator(".tile-path").first()).toBeVisible();

    // Stage it via the ActionPanel; the staged chip shows in the bar (05).
    await page.getByRole("button", { name: "Wait in place" }).click();
    await expect(page.getByTestId("staged-chip-1")).toBeVisible();

    // One staged unit leaves 9 un-acted ⇒ the confirm dialog first (05).
    await page.getByTestId("end-turn").click();
    await expect(page.getByRole("dialog")).toContainText("9 unit(s) have not acted");
    await page.getByRole("button", { name: "End turn" }).last().click();

    // The AI turn resolves: polling settles the banner on Turn 2 / Your turn.
    await expect(page.locator(".phase-banner")).toContainText("Turn 2");
    await expect(page.locator(".phase-banner")).toContainText("Your turn");

    // The mocked AI turn is authoritative: at least one enemy unit moved,
    // and its sprite re-anchored on the transform-positioned layer.
    const after = await getGame(page.request, gameId);
    expect(after.turnNumber).toBe(2);
    const moved = movedUnits(before, after);
    expect(moved.length).toBeGreaterThan(0);
    for (const unit of moved) {
      // aria-label carries the live tile: "<side> <class> at <x>,<y>" (05).
      await expect(page.getByTestId(`unit-${unit.id}`)).toHaveAttribute(
        "aria-label",
        new RegExp(` at ${unit.x},${unit.y}$`),
      );
    }
  });
});
