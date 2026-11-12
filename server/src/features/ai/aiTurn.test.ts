// The AI-turn job (docs/04): server-side menu-choice policy, no LLM.
// Verifies: successful application + persistence, conditional persist guard,
// victory-on-wipe, and stale recovery re-trigger.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { engineConfig } from "../../config/engine";
import { migrate } from "../../db/migrate";
import { pool } from "../../db/pool";
import type { Board, ClassKey, Side, Tile, Unit } from "../../game/types";
import { insertUser } from "../users/repo";
import { retriggerStaleJobs } from "../games/jobs";
import { getGameById, insertGeneratingGame, type GameRow } from "../games/repo";
import { runAiTurn } from "./aiTurn";

const EMAIL_DOMAIN = "dc2-aiturn.example";
const suffix = crypto.randomUUID().slice(0, 8);
let userId = "";

function plainBoard(): Board {
  const size = engineConfig.boardSize;
  return { tiles: Array.from({ length: size }, () => Array<Tile>(size).fill("plain")) };
}

function unit(id: string, cls: ClassKey, side: Side, x: number, y: number, hp?: number): Unit {
  const maxHp = engineConfig.classes[cls].hp;
  return { id, side, class: cls, x, y, hp: hp ?? maxHp, maxHp, acted: false };
}

function fullUnits(): Unit[] {
  return [
    unit("E-spear-2", "spear", "enemy", 5, 0),
    unit("E-archer-1", "archer", "enemy", 6, 0),
    unit("E-archer-2", "archer", "enemy", 8, 0),
    unit("E-mage-1", "mage", "enemy", 10, 0),
    unit("E-healer-1", "healer", "enemy", 11, 0),
    unit("E-sword-1", "sword", "enemy", 5, 1),
    unit("E-sword-2", "sword", "enemy", 6, 1),
    unit("E-axe-1", "axe", "enemy", 7, 1),
    unit("E-axe-2", "axe", "enemy", 8, 1),
    unit("E-spear-1", "spear", "enemy", 9, 1),
    unit("P-sword-1", "sword", "player", 4, 13),
    unit("P-sword-2", "sword", "player", 5, 13),
    unit("P-axe-1", "axe", "player", 6, 13),
    unit("P-axe-2", "axe", "player", 7, 13),
    unit("P-spear-1", "spear", "player", 8, 13),
    unit("P-spear-2", "spear", "player", 9, 13),
    unit("P-archer-1", "archer", "player", 10, 13),
    unit("P-archer-2", "archer", "player", 11, 13),
    unit("P-mage-1", "mage", "player", 9, 14),
    unit("P-healer-1", "healer", "player", 10, 14),
  ];
}

async function insertAiTurnGame(units: Unit[], difficulty = "aggressive"): Promise<GameRow> {
  const game = await insertGeneratingGame({ id: crypto.randomUUID(), userId, difficulty });
  await pool.query("UPDATE games SET status = 'ai_turn', board = $2, units = $3 WHERE id = $1", [
    game.id,
    JSON.stringify(plainBoard()),
    JSON.stringify(units),
  ]);
  const row = await getGameById(game.id);
  if (row === undefined) throw new Error("game missing");
  return row;
}

async function rowOf(gameId: string): Promise<GameRow> {
  const row = await getGameById(gameId);
  if (row === undefined) throw new Error(`game ${gameId} missing`);
  return row;
}

async function waitFor(gameId: string, predicate: (row: GameRow) => boolean): Promise<GameRow> {
  const deadline = Date.now() + 5000;
  for (;;) {
    const row = await rowOf(gameId);
    if (predicate(row)) return row;
    if (Date.now() > deadline) throw new Error(`game ${gameId} never settled`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeAll(async () => {
  await migrate();
  const user = await insertUser(`aiturn-${suffix}@${EMAIL_DOMAIN}`, `aiturn_${suffix}`, "x");
  userId = user.id;
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`%@${EMAIL_DOMAIN}`]);
  await pool.end();
});

describe("runAiTurn — server-side policy (docs/04)", () => {
  it("applies a legal policy turn: status flips player_turn, turn advances, lastAiActions populated", async () => {
    const game = await insertAiTurnGame(fullUnits(), "aggressive");

    await runAiTurn(game.id);

    const row = await rowOf(game.id);
    expect(row.status).toBe("player_turn");
    expect(row.turn_number).toBe(2);
    expect(row.ai_last_error).toBeNull();
    expect(Array.isArray(row.last_ai_actions)).toBe(true);
    expect((row.last_ai_actions as unknown[]).length).toBeGreaterThan(0);
    // Every action belongs to an enemy unit and has a path + action.
    for (const action of row.last_ai_actions as Array<{
      unitId: string;
      path: unknown;
      action: unknown;
    }>) {
      expect(action.unitId.startsWith("E-")).toBe(true);
      expect(Array.isArray(action.path)).toBe(true);
      expect(action.action).toBeDefined();
    }
  });

  it("aggressive advances toward the player on an open board (turn 1)", async () => {
    const game = await insertAiTurnGame(fullUnits(), "aggressive");
    await runAiTurn(game.id);
    const row = await rowOf(game.id);
    // At least some front enemy units should have moved south (larger y) from spawn rows.
    const movedSouth = row.units.some(
      (u) => u.side === "enemy" && u.y > 1 && u.id !== "E-healer-1",
    );
    expect(movedSouth).toBe(true);
  });

  it("defensive holds ground on an open board (no reckless advance)", async () => {
    const game = await insertAiTurnGame(fullUnits(), "defensive");
    await runAiTurn(game.id);
    const row = await rowOf(game.id);
    expect(row.status).toBe("player_turn");
    // Defensive should not charge deep into the board on turn 1 with no contact.
    const deep = row.units.filter((u) => u.side === "enemy" && u.y >= 5).length;
    expect(deep).toBe(0);
  });

  it("conditional persist: a forfeited game (not ai_turn) is not overwritten", async () => {
    const game = await insertAiTurnGame(fullUnits());
    await pool.query("UPDATE games SET status = 'lost' WHERE id = $1", [game.id]);

    await runAiTurn(game.id);

    const row = await rowOf(game.id);
    expect(row.status).toBe("lost"); // forfeit stands
    expect(row.turn_number).toBe(1);
    expect(row.last_ai_actions).toBeNull();
  });

  it("ai_turn → lost when the player's army is wiped (never won)", async () => {
    // One player unit left at 1 hp, within an archer's range-2: aggressive
    // policy takes the available attack pair and kills it.
    const units = [
      ...fullUnits().filter((u) => u.side === "enemy"),
      unit("P-sword-1", "sword", "player", 6, 2, 1),
    ];
    // Ensure an archer can shoot from its position: E-archer-1 is at (6,0),
    // distance to (6,2) is 2 — in range [2].
    const game = await insertAiTurnGame(units, "aggressive");

    await runAiTurn(game.id);

    const row = await rowOf(game.id);
    expect(row.status).toBe("lost");
    expect(row.turn_number).toBe(2);
    expect(row.ai_last_error).toBeNull();
    const actions = row.last_ai_actions as Array<{
      unitId: string;
      action: { type: string; targetId?: string };
    }>;
    expect(actions.some((a) => a.action.type === "attack")).toBe(true);
  });

  it("stale recovery re-triggers an ai_turn game and completes it", async () => {
    const game = await insertAiTurnGame(fullUnits(), "aggressive");
    // Simulate staleness so the sweep picks it up.
    await pool.query("UPDATE games SET updated_at = now() - interval '5 minutes' WHERE id = $1", [
      game.id,
    ]);
    await retriggerStaleJobs(userId, game.id);

    const row = await waitFor(game.id, (candidate) => candidate.status === "player_turn");
    expect(row.ai_last_error).toBeNull();
    expect(row.turn_number).toBe(2);
  });

  it("a FRESH ai_turn row is not re-triggered by the sweep", async () => {
    const game = await insertAiTurnGame(fullUnits());
    const before = await rowOf(game.id);
    await retriggerStaleJobs(userId, game.id);
    // Give it a moment; it should remain untouched.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const row = await rowOf(game.id);
    expect(row.status).toBe("ai_turn");
    expect(row.turn_number).toBe(before.turn_number);
    expect(row.last_ai_actions).toBeNull();
  });
});
