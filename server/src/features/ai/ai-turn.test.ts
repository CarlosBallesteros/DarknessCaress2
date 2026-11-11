// AI turn pipeline tests (docs/04's test list 1-3): engine loop with the mock
// LLM's committed fixtures, the bounded retry loop with correction feedback,
// exhaustion, and the stale-recovery re-trigger through endpoints 9/11 with
// simulated stale timestamps. Runs against the real (loopback) database;
// LLM_MOCK=1 is injected by the vitest config.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createApp } from "../../app";
import { pool } from "../../db/pool";
import { engineConfig } from "../../game/engine-config";
import { applyMoves } from "../../game/apply";
import { makeBoard, e, p } from "../../game/fixtures";
import type { Board, Unit } from "../../game/types";
import type { GameRow } from "../games/games.repo";
import {
  applyAiTurnResult,
  getGameById,
  insertGame,
} from "../games/games.repo";
import { serializeState } from "./serialize";
import { parseSerializedState, standaloneTurnBundle } from "./standalone-turn";
import { mockLlm, queueTurnFixtures, resetTurnFixtures } from "./mockLlm";
import {
  buildCorrectionMessage,
  retriggerStaleAiTurns,
  runAiTurn,
  runTurnValidationLoop,
} from "./ai-turn";

let server: Server;
let baseUrl: string;
const createdUserIds: string[] = [];

const uniqueUsername = () =>
  `u_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const uniqueEmail = () => `${randomUUID().replaceAll("-", "")}@example.com`;

function cookieOf(res: request.Response): string {
  const setCookie = res.headers["set-cookie"] as unknown as
    string[] | undefined;
  expect(setCookie, "expected a session cookie to be set").toBeDefined();
  return setCookie![0].split(";")[0];
}

async function registerAndGetCookie(): Promise<{
  cookie: string;
  userId: string;
}> {
  const res = await request(baseUrl).post("/api/auth/register").send({
    email: uniqueEmail(),
    password: "correct-horse",
    username: uniqueUsername(),
  });
  expect(res.status).toBe(201);
  createdUserIds.push(res.body.user.id);
  return { cookie: cookieOf(res), userId: res.body.user.id as string };
}

// A state the committed turn fixtures are legal/illegal against, verbatim.
function aiState(): { board: Board; units: Unit[] } {
  return {
    board: makeBoard(),
    units: [
      // turn.valid.json: E-sword-1 walks (5,1) → (5,2) and waits
      e("E-sword-1", "sword", 5, 1),
      // turn.illegal.json: E-archer-1 (range [2]) attacks a target exactly 3 away
      e("E-archer-1", "archer", 6, 0),
      p("P-sword-1", "sword", 6, 3),
      p("P-spear-1", "spear", 9, 13),
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
  await pool.query("UPDATE games SET status = 'ai_turn' WHERE id = $1", [
    row.id,
  ]);
  return row;
}

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await pool.query("DELETE FROM users WHERE id = ANY($1)", [createdUserIds]);
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await pool.end();
});

beforeEach(() => {
  resetTurnFixtures();
});

describe("runTurnValidationLoop (docs/04: the bounded validation loop)", () => {
  it("applies a valid first response — events in execution order, no corrections", async () => {
    const messages = [
      { role: "system" as const, content: "s" },
      { role: "user" as const, content: "u" },
    ];
    const result = await runTurnValidationLoop({
      llm: mockLlm,
      messages,
      temperature: 0.7,
      state: aiState(),
      engineCfg: engineConfig,
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
      llm: mockLlm,
      messages,
      temperature: 0.7,
      state: aiState(),
      engineCfg: engineConfig,
      retries: 3,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempt).toBe(2);
    // the unparsable fixture surfaces as the typed LlmError — a failed
    // attempt whose feedback is the documented schema message
    expect(messages[2]?.role).toBe("user");
    expect(messages[2]?.content).toBe(
      "Your reply was not valid JSON matching the schema.",
    );
  });

  it("illegal move once then valid: the correction carries the ENGINE's exact text", async () => {
    queueTurnFixtures("turn.illegal.json", "turn.valid.json");
    const messages = [
      { role: "system" as const, content: "s" },
      { role: "user" as const, content: "u" },
    ];
    const result = await runTurnValidationLoop({
      llm: mockLlm,
      messages,
      temperature: 0.7,
      state: aiState(),
      engineCfg: engineConfig,
      retries: 3,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempt).toBe(2);
    const correction = messages[3]?.content ?? "";
    expect(correction).toContain("E-archer-1");
    expect(correction).toContain("archer cannot attack a unit at 3 tiles");
    expect(correction).toContain("Resubmit the FULL corrected move list.");
  });

  it("exhausts after moveRetries failures with the LAST error (docs/04)", async () => {
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
      llm: mockLlm,
      messages,
      temperature: 0.7,
      state: aiState(),
      engineCfg: engineConfig,
      retries: 3,
    });
    expect(result).toEqual({ ok: false, error: "unknown unit E-ghost-1" });
    expect(messages).toHaveLength(2 + 3 * 2); // assistant reply + correction per attempt
  });

  it("the retry budget comes from config, not code", async () => {
    queueTurnFixtures(
      "turn.exhausting.json",
      "turn.exhausting.json",
      "turn.exhausting.json",
      "turn.exhausting.json",
      "turn.exhausting.json",
    );
    const messages = [
      { role: "system" as const, content: "s" },
      { role: "user" as const, content: "u" },
    ];
    const result = await runTurnValidationLoop({
      llm: mockLlm,
      messages,
      temperature: 0.7,
      state: aiState(),
      engineCfg: engineConfig,
      retries: 5,
    });
    expect(result).toEqual({ ok: false, error: "unknown unit E-ghost-1" });
    expect(messages).toHaveLength(2 + 5 * 2);
  });

  it("buildCorrectionMessage prefixes the unit ids for context", () => {
    expect(
      buildCorrectionMessage(
        [{ unitId: "E-archer-1", path: [[6, 0]], action: { type: "wait" } }],
        "archer cannot attack a unit at 3 tiles",
      ),
    ).toBe(
      "E-archer-1: archer cannot attack a unit at 3 tiles. Resubmit the FULL corrected move list.",
    );
  });
});

describe("runAiTurn (docs/01/04: the background job)", () => {
  it("success: status player_turn, turn+1, lastAiActions stored, error cleared", async () => {
    const { userId } = await registerAndGetCookie();
    const row = await insertAiTurnGame(userId, aiState());
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
    const sword = after?.units.find((u) => u.id === "E-sword-1");
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

  it("a forfeit during thinking discards the job's result (docs/01: conditional persist)", async () => {
    const { userId } = await registerAndGetCookie();
    const row = await insertAiTurnGame(userId, aiState());
    await pool.query("UPDATE games SET status = 'lost' WHERE id = $1", [
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

describe("stale recovery through endpoints 9/11 (docs/01)", () => {
  it("GET /api/games/:id re-triggers an exhausted game once updated_at goes stale", async () => {
    const { cookie, userId } = await registerAndGetCookie();
    const row = await insertAiTurnGame(userId, aiState());
    queueTurnFixtures(
      "turn.exhausting.json",
      "turn.exhausting.json",
      "turn.exhausting.json",
    );
    await runAiTurn(row.id);
    expect(await getGameById(row.id)).toMatchObject({ status: "ai_turn" });

    // not stale yet → a sweep re-triggers nothing
    await retriggerStaleAiTurns(userId, row.id);
    expect(await getGameById(row.id)).toMatchObject({
      status: "ai_turn",
      turn_number: 1,
    });

    // simulated staleness: updated_at older than config.ai.staleAfterSeconds
    await pool.query(
      "UPDATE games SET updated_at = now() - interval '61 seconds' WHERE id = $1",
      [row.id],
    );
    resetTurnFixtures(); // the re-triggered job (default fixture) SUCCEEDS
    const res = await request(baseUrl)
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
    await pool.query(
      "UPDATE games SET updated_at = now() - interval '61 seconds' WHERE id = $1",
      [row.id],
    );
    const res = await request(baseUrl).get("/api/games").set("Cookie", cookie);
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

describe("standalone mock turn (docs/04: no fixture against live boards)", () => {
  it("parseSerializedState round-trips the serializer's snapshot", () => {
    const board = makeBoard([
      [7, 7, "lake"],
      [5, 5, "river"],
      [6, 5, "bridge"],
    ]);
    const units = aiState().units;
    const parsed = parseSerializedState(serializeState(board, units));
    expect(parsed?.board).toEqual(board);
    expect(parsed?.units).toEqual(units.map((u) => ({ ...u, acted: false })));
    expect(parseSerializedState("garbage")).toBeUndefined();
  });

  it("the first enemy unit by id moves to the first adjacent free tile, path [own, target]", () => {
    const board = makeBoard();
    const units = [
      e("E-sword-1", "sword", 5, 1),
      e("E-axe-1", "axe", 7, 1),
      p("P-sword-1", "sword", 9, 13),
    ];
    const bundle = standaloneTurnBundle([
      { role: "user", content: serializeState(board, units) },
    ]) as { moves: Array<{ unitId: string; path: number[][] }> };
    // id-sorted: E-axe-1 acts, everyone else omits (explicitly legal)
    expect(bundle.moves).toHaveLength(1);
    expect(bundle.moves[0].unitId).toBe("E-axe-1");
    expect(bundle.moves[0].path[0]).toEqual([7, 1]);
    // and the engine accepts the bundle against the real state
    const applied = applyMoves(
      { board, units },
      [
        {
          unitId: bundle.moves[0].unitId,
          path: bundle.moves[0].path as Array<[number, number]>,
          action: { type: "wait" },
        },
      ],
      "enemy",
      engineConfig,
    );
    expect(applied.ok).toBe(true);
  });

  it("fully surrounded: an explicit wait entry at the unit's own tile", () => {
    const board = makeBoard();
    const units = [
      e("E-sword-1", "sword", 5, 5),
      p("P-sword-1", "sword", 5, 4),
      p("P-sword-2", "sword", 5, 6),
      p("P-axe-1", "axe", 4, 5),
      p("P-axe-2", "axe", 6, 5),
    ];
    const bundle = standaloneTurnBundle([
      { role: "user", content: serializeState(board, units) },
    ]) as { moves: Array<{ unitId: string; path: number[][] }> };
    expect(bundle.moves).toEqual([
      { unitId: "E-sword-1", path: [[5, 5]], action: { type: "wait" } },
    ]);
  });
});
