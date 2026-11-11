// The AI-turn validation loop (docs/04 test list 1–3) driven by the
// committed MockLlm fixtures: success path, retry on malformed JSON and on an
// illegal move (the feedback carries the engine's exact rejection), the
// exhaustion path (ai_last_error set, status stays ai_turn, turn unchanged),
// stale recovery re-triggering, and the conditional-persist guard.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { engineConfig } from "../../config/engine";
import { config } from "../../config/load";
import { migrate } from "../../db/migrate";
import { pool } from "../../db/pool";
import type { Board, ClassKey, Side, Tile, Unit } from "../../game/types";
import { insertUser } from "../users/repo";
import { retriggerStaleJobs } from "../games/jobs";
import { getGameById, insertGeneratingGame, type GameRow } from "../games/repo";
import { runAiTurn } from "./aiTurn";
import { queueTurnFixtures, recordedTurns, resetTurnFixtures } from "./mockLlm";

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

// The docs/04 example arrangement (enemy on rows 0-1, player on 13-14
// within the 8×2 spawn block) — the coordinate-bound fixtures apply to it.
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

beforeEach(() => {
  resetTurnFixtures();
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`%@${EMAIL_DOMAIN}`]);
  await pool.end();
});

describe("runAiTurn — the validation loop (docs/04)", () => {
  it("success path: the valid fixture applies; status flips player_turn, turn advances, lastAiActions populated", async () => {
    const game = await insertAiTurnGame(fullUnits());
    queueTurnFixtures(["turn.valid.json"]);

    await runAiTurn(game.id);

    const row = await rowOf(game.id);
    expect(row.status).toBe("player_turn");
    expect(row.turn_number).toBe(2);
    expect(row.ai_last_error).toBeNull();
    expect(row.last_ai_actions).toEqual([
      { unitId: "E-sword-1", path: [[5, 1]], action: { type: "wait" }, outcome: null },
    ]);
    // acted was set on the entry's unit only; positions untouched by a wait.
    const units = row.units;
    expect(units.find((u) => u.id === "E-sword-1")?.acted).toBe(true);
    expect(units.find((u) => u.id === "E-axe-1")?.acted).toBe(false);
    expect(units.find((u) => u.id === "E-sword-1")?.x).toBe(5);
  });

  it("the conversation carries the system prompt and the serialized state", async () => {
    const game = await insertAiTurnGame(fullUnits());
    queueTurnFixtures(["turn.valid.json"]);
    await runAiTurn(game.id);

    expect(recordedTurns).toHaveLength(1);
    const { messages, temperature } = recordedTurns[0];
    expect(temperature).toBe(config.personalities.aggressive.temperature);
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("PERSONA: Hunt them without mercy.");
    expect(messages[1].role).toBe("user");
    expect(messages[1].content).toContain("UNITS:");
    expect(messages[1].content).toContain("E-sword-1=sword 5,1 20/20");
  });

  it("malformed JSON once, then valid — schema feedback, success on attempt 2", async () => {
    const game = await insertAiTurnGame(fullUnits());
    queueTurnFixtures(["turn.malformed.json", "turn.valid.json"]);

    await runAiTurn(game.id);

    const row = await rowOf(game.id);
    expect(row.status).toBe("player_turn");
    expect(row.turn_number).toBe(2);
    expect(recordedTurns).toHaveLength(2);
    // The unparsable reply never became an assistant turn; the mandated
    // schema message went back to the model (docs/04).
    const retry = recordedTurns[1].messages;
    expect(retry).toHaveLength(3);
    expect(retry[2]).toEqual({
      role: "user",
      content: "Your reply was not valid JSON matching the schema.",
    });
  });

  it("an illegal move once, then valid — the feedback carries the engine's exact rejection", async () => {
    const game = await insertAiTurnGame(fullUnits());
    queueTurnFixtures(["turn.illegal.json", "turn.valid.json"]);

    await runAiTurn(game.id);

    const row = await rowOf(game.id);
    expect(row.status).toBe("player_turn");
    expect(row.ai_last_error).toBeNull();
    expect(recordedTurns).toHaveLength(2);
    // E-archer-1 (6,0) attacks P-sword-1 (4,13): Manhattan 15 — out of the
    // archer's [2] range (docs/02 catalogue text, unit ids for context).
    const feedback = recordedTurns[1].messages.at(-1);
    expect(feedback?.role).toBe("user");
    expect(feedback?.content).toContain("E-archer-1: archer cannot attack a unit at 15 tiles");
    expect(feedback?.content).toContain("Resubmit the FULL corrected move list.");
    expect(recordedTurns[1].messages.at(-2)?.role).toBe("assistant");
  });

  it("exhaustion after moveRetries: ai_last_error set, status stays ai_turn, turn unchanged", async () => {
    const game = await insertAiTurnGame(fullUnits());
    queueTurnFixtures(["turn.exhausting.json", "turn.exhausting.json", "turn.exhausting.json"]);

    await runAiTurn(game.id);

    const row = await rowOf(game.id);
    expect(row.status).toBe("ai_turn"); // never a heuristic fallback
    expect(row.turn_number).toBe(1); // unchanged on failure
    expect(row.ai_last_error).toBe("unknown unit E-ghost-1");
    expect(row.updated_at.getTime()).toBeGreaterThan(Date.now() - 60_000); // fresh sweep timer
    expect(recordedTurns).toHaveLength(config.ai.moveRetries);
    expect(row.last_ai_actions).toBeNull(); // nothing applied
  });

  it("stale recovery re-triggers an exhausted game (simulated stale timestamps)", async () => {
    const game = await insertAiTurnGame(fullUnits());
    queueTurnFixtures(["turn.exhausting.json", "turn.exhausting.json", "turn.exhausting.json"]);
    await runAiTurn(game.id);
    expect((await rowOf(game.id)).status).toBe("ai_turn");

    // Simulate staleness: the failed game waited its full stale window.
    await pool.query("UPDATE games SET updated_at = now() - interval '5 minutes' WHERE id = $1", [
      game.id,
    ]);
    queueTurnFixtures(["turn.valid.json"]); // the fresh attempt succeeds
    await retriggerStaleJobs(userId, game.id);

    const row = await waitFor(game.id, (candidate) => candidate.status === "player_turn");
    expect(row.ai_last_error).toBeNull();
    expect(row.turn_number).toBe(2);
  });

  it("a FRESH ai_turn row is not re-triggered (no hammering)", async () => {
    const game = await insertAiTurnGame(fullUnits());
    await retriggerStaleJobs(userId, game.id);
    // The sweep leaves it alone: still ai_turn, no LLM call.
    expect((await rowOf(game.id)).status).toBe("ai_turn");
    expect(recordedTurns).toHaveLength(0);
  });

  it("the conditional-persist guard: a forfeit during the thinking stands", async () => {
    const game = await insertAiTurnGame(fullUnits());
    await pool.query("UPDATE games SET status = 'lost' WHERE id = $1", [game.id]);
    queueTurnFixtures(["turn.valid.json"]);

    await runAiTurn(game.id);

    const row = await rowOf(game.id);
    expect(row.status).toBe("lost"); // the forfeit's lost stands (docs/06 ep. 15)
    expect(row.turn_number).toBe(1);
    expect(row.last_ai_actions).toBeNull();
    expect(row.units.find((u) => u.id === "E-sword-1")?.acted).toBe(false);
  });

  it("ai_turn → lost when the player's army is wiped (never won)", async () => {
    // Mid-game state: one player unit left, at 1 hp, within the archer's
    // range-2 of E-archer-1 — the committed turn.illegal fixture now applies
    // legally and kills the last player unit.
    const units = [
      ...fullUnits().filter((u) => u.side === "enemy"),
      unit("P-sword-1", "sword", "player", 6, 2, 1),
    ];
    const game = await insertAiTurnGame(units);
    queueTurnFixtures(["turn.illegal.json"]);

    await runAiTurn(game.id);

    const row = await rowOf(game.id);
    expect(row.status).toBe("lost");
    expect(row.turn_number).toBe(2);
    expect(row.ai_last_error).toBeNull();
    expect(row.last_ai_actions).toEqual([
      {
        unitId: "E-archer-1",
        path: [[6, 0]],
        action: { type: "attack", targetId: "P-sword-1" },
        outcome: {
          targetId: "P-sword-1",
          damage: 1, // 6 − 5; the 1-hp sword dies; archer is at range 2, no counter
          targetHp: 0,
          targetDied: true,
          counter: null,
        },
      },
    ]);
  });
});
