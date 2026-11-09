import { execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { getConfig, toEngineConfig } from "../../config/config.js";
import { applyMoves } from "../../game/apply.js";
import type { Board, Unit } from "../../game/types.js";
import { plainBoard, unit } from "../../test-game.js";
import { buildTurnUserMessage } from "./turnPrompt.js";
import { turnResponseSchema } from "./turnSchema.js";
import { MockLlm } from "./mockLlm.js";

/**
 * A LIVE-scattered state (03: per-side seeded-random spawn): units sit away
 * from the committed fixtures' coordinates (E-sword-1 at (10,1) — the observed
 * live position of the defect). The static turn fixtures are legal only
 * against unit-test-seeded states like aiState().
 */
function scatteredState(): { board: Board; units: Unit[] } {
  return {
    board: plainBoard(15),
    units: [
      unit("E-sword-1", "enemy", "sword", 10, 1, 20),
      unit("E-axe-1", "enemy", "axe", 9, 1, 25),
      unit("P-sword-1", "player", "sword", 6, 13, 20),
    ],
  };
}

/** Serialized the same way runAiTurn builds the user message (04). */
function messageOf(state: { board: Board; units: Unit[] }): string {
  return buildTurnUserMessage(state.board, state.units, getConfig());
}

/**
 * Simulates a manually-run server by removing every test-driver marker the
 * runners set (test-setup sets NODE_ENV=test; Vitest also injects VITEST).
 * Restored in finally so the fixture-queue-driven tests keep their frozen
 * behavior.
 */
function withoutTestDriver<T>(fn: () => T): T {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousVitest = process.env.VITEST;
  process.env.NODE_ENV = "development";
  delete process.env.VITEST;
  try {
    return fn();
  } finally {
    const setEnv = (name: string, value: string | undefined): void => {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    };
    setEnv("NODE_ENV", previousNodeEnv);
    setEnv("VITEST", previousVitest);
  }
}

describe("MockLlm.turn — standalone mode (04: manually-run server)", () => {
  it("produces a bundle applyMoves accepts on a live-scattered board", async () => {
    const state = scatteredState();
    const messages = [
      { role: "system" as const, content: "persona prompt" },
      { role: "user" as const, content: messageOf(state) },
    ];
    const raw = await withoutTestDriver(() =>
      new MockLlm().turn({ messages, temperature: 0.7 }),
    );
    // Shape per the contract, then the engine re-validates EVERYTHING —
    // the mock must survive the same pipeline the real client's reply runs:
    const moves = turnResponseSchema.parse(raw).moves;
    expect(moves).toEqual([
      {
        // deterministic: first enemy by id, first adjacent free tile in
        // reachableTiles' BFS order
        unitId: "E-axe-1",
        path: [
          [9, 1],
          [8, 1],
        ],
        action: { type: "wait" },
      },
    ]);
    const applied = applyMoves(
      state,
      moves,
      "enemy",
      toEngineConfig(getConfig()),
    );
    expect(applied).toMatchObject({ ok: true });
  });

  it("waits in place when the chosen unit is fully surrounded", async () => {
    const state = {
      board: plainBoard(15),
      units: [
        unit("E-sword-1", "enemy", "sword", 0, 0, 20),
        unit("P-spear-1", "player", "spear", 1, 0, 18),
        unit("P-axe-1", "player", "axe", 0, 1, 25),
      ],
    };
    const messages = [
      { role: "system" as const, content: "persona prompt" },
      { role: "user" as const, content: messageOf(state) },
    ];
    const raw = await withoutTestDriver(() =>
      new MockLlm().turn({ messages, temperature: 0.7 }),
    );
    const moves = turnResponseSchema.parse(raw).moves;
    expect(moves).toEqual([
      {
        unitId: "E-sword-1",
        path: [[0, 0]],
        action: { type: "wait" },
      },
    ]);
    expect(
      applyMoves(state, moves, "enemy", toEngineConfig(getConfig())),
    ).toMatchObject({ ok: true });
  });

  it("is deterministic: the same state yields the same bundle", async () => {
    const state = scatteredState();
    const messages = [
      { role: "system" as const, content: "persona prompt" },
      { role: "user" as const, content: messageOf(state) },
    ];
    const first = await withoutTestDriver(() =>
      new MockLlm().turn({ messages, temperature: 0.7 }),
    );
    const second = await withoutTestDriver(() =>
      new MockLlm().turn({ messages, temperature: 0.7 }),
    );
    expect(second).toEqual(first);
  });
});

describe("MockLlm — the committed fixture contract (04)", () => {
  it("resolves fixtures when loaded from dist/ build output", () => {
    // tsc does not copy .json into dist/ — the runtime-asset URL must point
    // at the package-root src/ so BOTH src/ and dist/ runs resolve (config.ts
    // precedent). The compiled artifact runs in a real node child process.
    const serverRoot = resolve(
      fileURLToPath(new URL("../../..", import.meta.url)),
    );
    const distMock = resolve(serverRoot, "dist/features/ai/mockLlm.js");
    const srcMock = resolve(serverRoot, "src/features/ai/mockLlm.ts");
    if (
      !existsSync(distMock) ||
      statSync(srcMock).mtimeMs > statSync(distMock).mtimeMs
    ) {
      execSync("npx tsc", { cwd: serverRoot, stdio: "pipe" });
    }
    const script = `import { MockLlm, queueTurnFixtures } from ${JSON.stringify(pathToFileURL(distMock).href)};
      queueTurnFixtures("turn.valid.json");
      const reply = await new MockLlm().turn({ messages: [], temperature: 0 });
      process.stdout.write(JSON.stringify(reply));`;
    const run = spawnSync(process.execPath, [
      "--input-type=module",
      "-e",
      script,
    ]);
    expect(run.error).toBeUndefined();
    expect(run.status).toBe(0);
    const reply = JSON.parse(run.stdout.toString()) as unknown;
    const committed = JSON.parse(
      readFileSync(
        new URL("./__fixtures__/turn.valid.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    expect(reply).toEqual(committed);
  });
});
