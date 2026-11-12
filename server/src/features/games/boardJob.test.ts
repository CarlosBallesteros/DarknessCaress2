// Board-design background job (docs/06 endpoint 10 + docs/01 Runtime model):
// success flips the row to player_turn under the conditional-persist guard;
// total failure (even the fallback — a code bug) writes ai_last_error with a
// fresh updated_at and LEAVES generating_board for the stale sweep; the sweep
// re-triggers stale rows through the ACTIVE-JOB set guard.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { sabotageEnabled, briefBehavior } = vi.hoisted(() => ({
  sabotageEnabled: { value: true },
  briefBehavior: { value: "valid" as "valid" | "invalid" | "throwing" },
}));

// Sabotage every materialization (fallback seed included) so the whole
// pipeline — budget included — exhausts and the job takes its failure path.
vi.mock("../board/materialize", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../board/materialize")>();
  return {
    ...actual,
    materialize: (brief: Parameters<typeof actual.materialize>[0], seed: number) => {
      const board = actual.materialize(brief, seed);
      if (sabotageEnabled.value) {
        for (const row of board.tiles) row.fill("lake");
      }
      return board;
    },
  };
});

// The LLM seam is scripted per test: a zod-valid brief (the normal mock
// flow), schema-invalid garbage (every brief of the budget fails → the
// fallback template fires), or a dead Ollama.
vi.mock("../ai/llmClient", () => ({
  getLlmClient: () => ({
    chat: async () => {
      throw new Error("not used");
    },
    brief: async () => {
      if (briefBehavior.value === "throwing") {
        throw new Error("Ollama is unreachable");
      }
      if (briefBehavior.value === "invalid") {
        return { nope: true };
      }
      return {
        river: null,
        bridgeTiles: 1,
        forestZones: [
          { centerX: 2, centerY: 2, radius: 1 },
          { centerX: 5, centerY: 4, radius: 1 },
        ],
        hillZones: [{ centerX: 4, centerY: 3, radius: 1 }],
        lake: { centerX: 3, centerY: 3, radius: 1 },
      };
    },
    turn: async () => {
      throw new Error("turn() is implemented in phase 5");
    },
  }),
}));

import { migrate } from "../../db/migrate";
import { pool } from "../../db/pool";
import { insertUser } from "../users/repo";
import { getGameById, insertGeneratingGame, type GameRow } from "./repo";
import { retriggerStaleJobs, runBoardDesignJob, startGameJob } from "./jobs";

const EMAIL_DOMAIN = "dc2-boardjob.example";
const suffix = crypto.randomUUID().slice(0, 8);
const email = `job-${suffix}@${EMAIL_DOMAIN}`;
let userId = "";

async function freshGame(): Promise<GameRow> {
  return insertGeneratingGame({
    id: crypto.randomUUID(),
    userId,
    difficulty: "aggressive",
  });
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
  const user = await insertUser(email, `job_${suffix}`, "x");
  userId = user.id;
});

afterAll(async () => {
  await pool.query("DELETE FROM users WHERE email LIKE $1", [`%@${EMAIL_DOMAIN}`]);
  await pool.end();
});

describe("runBoardDesignJob", () => {
  beforeEach(() => {
    sabotageEnabled.value = true;
    briefBehavior.value = "valid";
  });

  it("flips the row to player_turn with the designed board and armies on success", async () => {
    sabotageEnabled.value = false;
    const game = await freshGame();
    await runBoardDesignJob(game.id);
    const row = await rowOf(game.id);
    expect(row.status).toBe("player_turn");
    expect(row.ai_last_error).toBeNull();
    expect(row.used_fallback).toBe(false);
    expect(row.units).toHaveLength(20);
    // Not the all-plain placeholder anymore.
    expect(row.board.tiles.flat().some((tile) => tile !== "plain")).toBe(true);
  });

  it("records used_fallback = true in the row when the fallback template fires", async () => {
    sabotageEnabled.value = false;
    briefBehavior.value = "invalid"; // every brief of the budget fails
    const game = await freshGame();
    await runBoardDesignJob(game.id);
    const row = await rowOf(game.id);
    expect(row.status).toBe("player_turn"); // the fallback still SUCCEEDS
    expect(row.used_fallback).toBe(true);
    expect(row.ai_last_error).toBeNull();
    expect(row.units).toHaveLength(20);
  });

  it("an unreachable LLM still lands on the fallback (used_fallback = true)", async () => {
    sabotageEnabled.value = false;
    briefBehavior.value = "throwing";
    const game = await freshGame();
    await runBoardDesignJob(game.id);
    const row = await rowOf(game.id);
    expect(row.status).toBe("player_turn");
    expect(row.used_fallback).toBe(true);
  });

  it("on total failure stays generating_board with ai_last_error + fresh updated_at", async () => {
    const game = await freshGame();
    // An old timestamp: the failure must refresh it (fresh sweep timer).
    await pool.query("UPDATE games SET updated_at = now() - interval '1 hour' WHERE id = $1", [
      game.id,
    ]);
    await runBoardDesignJob(game.id);
    const row = await rowOf(game.id);
    expect(row.status).toBe("generating_board"); // retried forever by the sweep
    expect(row.ai_last_error).toContain("fallback board is invalid");
    expect(row.updated_at.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it("stands down when the row already left generating_board", async () => {
    const game = await freshGame();
    await pool.query("UPDATE games SET status = 'lost' WHERE id = $1", [game.id]);
    await runBoardDesignJob(game.id);
    const row = await rowOf(game.id);
    expect(row.status).toBe("lost"); // the forfeit's lost stands (docs/06 ep. 15)
    expect(row.board.tiles[7][7]).toBe("plain"); // placeholder untouched
  });
});

describe("retriggerStaleJobs (the sweep)", () => {
  it("re-triggers a stale generating_board row through the job", async () => {
    sabotageEnabled.value = false;
    const game = await freshGame();
    await pool.query("UPDATE games SET updated_at = now() - interval '5 minutes' WHERE id = $1", [
      game.id,
    ]);
    await retriggerStaleJobs(userId, game.id);
    const row = await waitFor(game.id, (candidate) => candidate.status === "player_turn");
    expect(row.status).toBe("player_turn");
  });

  it("leaves a FRESH generating_board row alone (no hammering)", async () => {
    const game = await freshGame();
    await retriggerStaleJobs(userId, game.id);
    const row = await rowOf(game.id);
    expect(row.status).toBe("generating_board"); // not yet stale; job not re-run
  });
});

describe("ACTIVE-JOB set guard (docs/01)", () => {
  it("a second synchronous trigger while a job runs is a no-op", async () => {
    let runs = 0;
    const gameId = `guard-${crypto.randomUUID()}`;
    const job = vi.fn(async () => {
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    startGameJob(gameId, job);
    startGameJob(gameId, job);
    expect(runs).toBe(1); // check-and-set happened in the same tick
    await vi.waitFor(() => {
      expect(job).toHaveBeenCalledOnce();
    });
  });

  it("the guard key is the game: two games run their jobs independently", async () => {
    let runs = 0;
    const job = vi.fn(async () => {
      runs++;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const first = `pair-${crypto.randomUUID()}`;
    const second = `pair-${crypto.randomUUID()}`;
    startGameJob(first, job);
    startGameJob(second, job);
    await vi.waitFor(() => expect(runs).toBe(2));
  });
});
