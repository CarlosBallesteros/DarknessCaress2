// Mock client contract (docs/04): the committed fixtures load through the
// runtime-asset pattern, brief() serves the committed valid brief, and the
// test runners' LLM_MOCK=1 selects the mock — never a live Ollama in tests.
// turn() serves queued fixtures for the test driver, surfaces unparsable
// fixtures as LlmError, and in standalone mode computes a deterministic
// minimal-legal turn from the serialized state.
import { afterEach, describe, expect, it } from "vitest";
import { engineConfig } from "../../config/engine";
import { applyMoves } from "../../game/apply";
import type { Board, ClassKey, Move, Side, Tile, Unit } from "../../game/types";
import { turnUserMessage } from "./turnPrompt";
import { env } from "../../env";
import { briefSchema } from "../board/briefSchema";
import { briefPrompt } from "../board/briefPrompt";
import { getLlmClient, LlmError, ollamaLlm } from "./llmClient";
import { mockLlm, queueTurnFixtures, resetTurnFixtures } from "./mockLlm";

function plainBoard(): Board {
  const size = engineConfig.boardSize;
  return { tiles: Array.from({ length: size }, () => Array<Tile>(size).fill("plain")) };
}

function unit(id: string, cls: ClassKey, side: Side, x: number, y: number): Unit {
  const maxHp = engineConfig.classes[cls].hp;
  return { id, side, class: cls, x, y, hp: maxHp, maxHp, acted: false };
}

afterEach(() => resetTurnFixtures());

describe("mock LlmClient", () => {
  it("is selected by the test runner's injected LLM_MOCK=1 (docs/04)", () => {
    expect(env.LLM_MOCK).toBe("1");
    expect(getLlmClient()).toBe(mockLlm);
  });

  it("brief() serves the committed brief.valid fixture and it zod-validates", async () => {
    const brief = await mockLlm.brief({ user: briefPrompt() });
    const parsed = briefSchema.safeParse(brief);
    expect(parsed.success).toBe(true);
  });

  it("turn() serves a queued fixture family by name", async () => {
    queueTurnFixtures(["turn.valid.json"]);
    const result = (await mockLlm.turn({ messages: [], temperature: 0.5 })) as {
      moves: Move[];
    };
    expect(result).toEqual({
      moves: [{ unitId: "E-sword-1", path: [[5, 1]], action: { type: "wait" } }],
    });
  });

  it("an unparsable fixture (turn.malformed) surfaces as the typed LlmError", async () => {
    queueTurnFixtures(["turn.malformed.json"]);
    await expect(mockLlm.turn({ messages: [], temperature: 0.5 })).rejects.toThrow(LlmError);
  });

  it("standalone mode: deterministic minimal-legal turn from the serialized state", async () => {
    const board = plainBoard();
    const units = [
      unit("E-sword-1", "sword", "enemy", 5, 1), // blocks the west neighbor (ally — not standable)
      unit("E-axe-1", "axe", "enemy", 6, 1), // first own unit by id
      unit("P-sword-1", "sword", "player", 4, 13),
    ];
    const messages = [{ role: "user" as const, content: turnUserMessage(board, units) }];

    const first = (await mockLlm.turn({ messages, temperature: 0.5 })) as { moves: Move[] };
    const second = (await mockLlm.turn({ messages, temperature: 0.5 })) as { moves: Move[] };
    expect(second).toEqual(first); // deterministic given the state

    // One entry for the id-sorted first unit; (5,1) is ally-occupied so the
    // first free adjacent tile in compass order is east, (7,1).
    expect(first.moves).toEqual([
      {
        unitId: "E-axe-1",
        path: [
          [6, 1],
          [7, 1],
        ],
        action: { type: "wait" },
      },
    ]);

    // The engine re-validates everything — the minimal turn must be legal.
    const applied = applyMoves({ board, units }, first.moves, "enemy", engineConfig);
    expect(applied.ok).toBe(true);
  });

  it("standalone mode: a fully surrounded unit waits at its own tile", async () => {
    const board = plainBoard();
    const units = [
      unit("E-axe-1", "axe", "enemy", 5, 1), // first own unit by id — fully surrounded
      unit("E-sword-1", "sword", "enemy", 6, 1),
      unit("E-sword-2", "sword", "enemy", 4, 1),
      unit("E-spear-1", "spear", "enemy", 5, 2),
      unit("E-spear-2", "spear", "enemy", 5, 0),
    ];
    const messages = [{ role: "user" as const, content: turnUserMessage(board, units) }];
    const result = (await mockLlm.turn({ messages, temperature: 0.5 })) as { moves: Move[] };
    expect(result.moves).toEqual([{ unitId: "E-axe-1", path: [[5, 1]], action: { type: "wait" } }]);
  });

  it("the real client fails loudly without a serialized state (schema bounds)", async () => {
    await expect(ollamaLlm.turn({ messages: [], temperature: 0.5 })).rejects.toThrow(
      "no serialized state in messages",
    );
  });

  it("the real client reaches Ollama only after deriving the bounds from state", async () => {
    // With a valid snapshot the bounds parse succeeds and the (unreachable in
    // tests) Ollama call is attempted — the typed LlmError comes from there.
    const board = plainBoard();
    const units = [unit("E-sword-1", "sword", "enemy", 5, 1)];
    const messages = [{ role: "user" as const, content: turnUserMessage(board, units) }];
    await expect(ollamaLlm.turn({ messages, temperature: 0.5 })).rejects.toThrow(LlmError);
  });
});
