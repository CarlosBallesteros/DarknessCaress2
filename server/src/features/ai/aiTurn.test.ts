import { randomUUID } from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../app.js";
import { getConfig, toEngineConfig } from "../../config/config.js";
import { getPool } from "../../db/pool.js";
import { plainBoard, unit } from "../../test-game.js";
import { useTestDb } from "../../test-db.js";
import { uniqueEmail, uniqueUsername } from "../../test-ids.js";
import type { Board, Unit } from "../../game/types.js";
import type { GameRow } from "../games/game.dto.js";
import {
  retriggerStaleAiTurns,
  runAiTurn,
  runTurnValidationLoop,
} from "./aiTurn.js";
import { applyAiTurnResult } from "../games/games.queries.js";
import { insertGame, getGameById } from "../games/games.queries.js";
import { MockLlm, queueTurnFixtures, resetTurnFixtures } from "./mockLlm.js";

const app = createApp();

function cookieOf(res: request.Response): string {
  return (res.headers["set-cookie"] as unknown as string[])[0];
}

async function registerAndGetCookie(): Promise<{
  cookie: string;
  userId: string;
}> {
  const res = await request(app).post("/api/auth/register").send({
    email: uniqueEmail(),
    password: "correct-horse",
    username: uniqueUsername(),
  });
  expect(res.status).toBe(201);
  const me = await request(app).get("/api/me").set("Cookie", cookieOf(res));
  return { cookie: cookieOf(res), userId: me.body.user.id as string };
}

/** A state the committed turn fixtures are legal/illegal against, verbatim. */
function aiState(): { board: Board; units: Unit[] } {
  return {
    board: plainBoard(15),
    units: [
      // turn.valid.json: E-sword-1 walks (5,1) → (5,2) and waits
      unit("E-sword-1", "enemy", "sword", 5, 1, 20),
      // turn.illegal.json: E-archer-1 (range [2]) attacks a target exactly 3 away
      unit("E-archer-1", "enemy", "archer", 6, 0, 16),
      unit("P-sword-1", "player", "sword", 6, 3, 20),
      unit("P-spear-1", "player", "spear", 9, 13, 18),
    ],
  };
}

async function insertAiTurnGame(
  userId: string,
  state: { board: Board; units: Unit[] },
): Promise<GameRow> {
  const row = await insertGame({
    id: randomUUID(),
    userId,
    difficulty: "aggressive",
    board: state.board,
    units: state.units,
    usedFallback: false,
  });
  await getPool().query("UPDATE games SET status = 'ai_turn' WHERE id = $1", [
    row.id,
  ]);
  return row;
}

beforeEach(() => {
  resetTurnFixtures();
});

useTestDb();

describe("runTurnValidationLoop (04: the bounded validation loop)", () => {
  const engineCfg = toEngineConfig(getConfig());

  it("applies a valid first response", async () => {
    const messages = [
      { role: "system" as const, content: "s" },
      { role: "user" as const, content: "u" },
    ];
    const result = await runTurnValidationLoop({
      llm: new MockLlm(),
      messages,
      temperature: 0.7,
      state: aiState(),
      engineCfg,
      retries: 3,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempt).toBe(1);
      expect(result.moves).toEqual([
        {
          unitId: "E-sword-1",
          path: [
            [5, 1],
            [5, 2],
          ],
          action: { type: "wait" },
        },
      ]);
      expect(result.applied.events).toEqual([
        { kind: "moved", unitId: "E-sword-1", from: [5, 1], to: [5, 2] },
        { kind: "wait", unitId: "E-sword-1" },
      ]);
    }
    expect(messages).toHaveLength(2); // no corrections on first success
  });

  it("malformed JSON once then valid: the model is told the schema message", async () => {
    queueTurnFixtures("turn.malformed.json", "turn.valid.json");
    const messages = [
      { role: "system" as const, content: "s" },
      { role: "user" as const, content: "u" },
    ];
    const result = await runTurnValidationLoop({
      llm: new MockLlm(),
      messages,
      temperature: 0.7,
      state: aiState(),
      engineCfg,
      retries: 3,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempt).toBe(2);
    }
    // the unparsable fixture surfaces as the typed LlmError — a failed attempt
    // whose feedback is the schema message (the model's reply was not JSON)
    expect(messages[2]?.role).toBe("user");
    expect(messages[2]?.content).toContain(
      "Your reply was not valid JSON matching the schema.",
    );
  });

  it("illegal move once then valid: the correction carries the ENGINE's text", async () => {
    queueTurnFixtures("turn.illegal.json", "turn.valid.json");
    const messages = [
      { role: "system" as const, content: "s" },
      { role: "user" as const, content: "u" },
    ];
    const result = await runTurnValidationLoop({
      llm: new MockLlm(),
      messages,
      temperature: 0.7,
      state: aiState(),
      engineCfg,
      retries: 3,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempt).toBe(2);
    }
    const correction = messages[3]?.content ?? "";
    expect(correction).toContain("E-archer-1");
    expect(correction).toContain("archer cannot attack a unit at 3 tiles");
    expect(correction).toContain("Resubmit the FULL corrected move list.");
  });

  it("exhausts after moveRetries failures with the LAST error (04)", async () => {
    queueTurnFixtures(
      "turn.exhausting.json",
      "turn.exhausting.json",
      "turn.exhausting.json",
    );
    const messages = [
      { role: "system" as const, content: "s" },
      { role: "user" as const, content: "u" },
    ];
    const result = await runTurnValidationLoop({
      llm: new MockLlm(),
      messages,
      temperature: 0.7,
      state: aiState(),
      engineCfg,
      retries: 3,
    });
    expect(result).toEqual({ ok: false, error: "unknown unit E-ghost-1" });
    expect(messages).toHaveLength(2 + 3 * 2); // assistant reply + correction per attempt
  });
});

describe("runAiTurn (01/04: the background job)", () => {
  it("success: status player_turn, turn+1, lastAiActions stored, error cleared", async () => {
    const { userId } = await registerAndGetCookie();
    const state = aiState();
    const row = await insertAiTurnGame(userId, state);
    await runAiTurn(row.id);
    const after = await getGameById(row.id);
    expect(after).toMatchObject({
      status: "player_turn",
      turn_number: 2,
      ai_last_error: null,
    });
    expect(after?.last_ai_actions).toEqual([
      {
        unitId: "E-sword-1",
        path: [
          [5, 1],
          [5, 2],
        ],
        action: { type: "wait" },
        outcome: null,
      },
    ]);
    const sword = after?.units.find(
      (candidate) => candidate.id === "E-sword-1",
    );
    expect(sword).toMatchObject({ x: 5, y: 2, acted: true });
  });

  it("exhaustion: ai_last_error set, status stays ai_turn, turn unchanged, NO unit moved", async () => {
    const { userId } = await registerAndGetCookie();
    const state = aiState();
    const row = await insertAiTurnGame(userId, state);
    queueTurnFixtures(
      "turn.exhausting.json",
      "turn.exhausting.json",
      "turn.exhausting.json",
    );
    await runAiTurn(row.id);
    const after = await getGameById(row.id);
    expect(after).toMatchObject({
      status: "ai_turn",
      turn_number: 1,
      ai_last_error: "unknown unit E-ghost-1",
    });
    expect(after?.units).toEqual(state.units); // no heuristic ever moved anything
    expect(after?.updated_at.getTime()).toBeGreaterThanOrEqual(
      row.updated_at.getTime(),
    ); // fresh sweep timer
  });

  it("a forfeit during thinking discards the job's result (01: conditional persist)", async () => {
    const { userId } = await registerAndGetCookie();
    const row = await insertAiTurnGame(userId, aiState());
    await getPool().query("UPDATE games SET status = 'lost' WHERE id = $1", [
      row.id,
    ]);
    const persisted = await applyAiTurnResult(row.id, {
      status: "player_turn",
      units: aiState().units,
      lastAiActions: [],
    });
    expect(persisted).toBe(false);
    const after = await getGameById(row.id);
    expect(after).toMatchObject({ status: "lost", turn_number: 1 });
  });
});

describe("stale recovery through endpoints 9/11 (01)", () => {
  it("GET /api/games/:id re-triggers an exhausted game once updated_at goes stale", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const row = await insertAiTurnGame(userId, aiState());
    queueTurnFixtures(
      "turn.exhausting.json",
      "turn.exhausting.json",
      "turn.exhausting.json",
    );
    await runAiTurn(row.id);
    const exhausted = await getGameById(row.id);
    expect(exhausted).toMatchObject({ status: "ai_turn" });

    // not stale yet → a sweep re-triggers nothing
    await retriggerStaleAiTurns(userId, row.id);
    expect(await getGameById(row.id)).toMatchObject({
      status: "ai_turn",
      turn_number: 1,
    });

    // simulated staleness: updated_at older than config.ai.staleAfterSeconds
    await getPool().query(
      "UPDATE games SET updated_at = now() - interval '61 seconds' WHERE id = $1",
      [row.id],
    );
    resetTurnFixtures(); // the next job (default fixture) SUCCEEDS
    const res = await request(app)
      .get(`/api/games/${row.id}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    await vi.waitFor(async () => {
      const recovered = await getGameById(row.id);
      expect(recovered).toMatchObject({
        status: "player_turn",
        turn_number: 2,
        ai_last_error: null,
      });
    });
  });

  it("GET /api/games sweeps the user's stale games too", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const row = await insertAiTurnGame(userId, aiState());
    await getPool().query(
      "UPDATE games SET updated_at = now() - interval '61 seconds' WHERE id = $1",
      [row.id],
    );
    const res = await request(app).get("/api/games").set("Cookie", cookie);
    expect(res.status).toBe(200);
    await vi.waitFor(async () => {
      const recovered = await getGameById(row.id);
      expect(recovered).toMatchObject({
        status: "player_turn",
        turn_number: 2,
      });
    });
  });
});
