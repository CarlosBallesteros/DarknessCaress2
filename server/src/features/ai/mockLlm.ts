// Mock LLM client (docs/04): same interface as the real one. Fixtures are
// committed, not invented at test time — the five families in __fixtures__/
// are the contract (brief.valid, turn.valid, turn.malformed, turn.illegal,
// turn.exhausting); their CONTENT is authoring-agent choice, the NAMES are
// not. turn.malformed.json is deliberately UNparsable JSON, so fixtures are
// loaded as text and parsed — an unparsable fixture surfaces as the typed
// LlmError, exactly what the real client produces, and the caller counts it
// as a failed attempt, never a crashed process.
//
// turn() selection: the TEST DRIVER queues fixture families by name (a
// Vitest/Playwright privilege — static coordinate fixtures must never be
// served against live scattered boards). With an empty queue — STANDALONE
// mode, the mocked client serving a manually-run server — turn() computes a
// deterministic minimal-legal turn from the current game state instead
// (docs/04); the engine re-validates everything.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { engineConfig } from "../../config/engine";
import { reachableTiles, tileKey } from "../../game/reach";
import type { Move } from "../../game/types";
import type { ChatMessage, LlmClient } from "./llmClient";
import { LlmError } from "./llmClient";
import { parseSerializedState } from "./serialize";

// Anchored at this module's directory (available both in src/ under the test
// runners and in the compiled dist/, where the build ships the fixtures
// alongside — tsc only copies JSON it imports, and malformed JSON cannot be
// imported).
function fixturePath(name: string): string {
  const local = join(__dirname, "__fixtures__", name);
  if (existsSync(local)) return local;
  return join(__dirname, "..", "..", "..", "src", "features", "ai", "__fixtures__", name);
}

function fixture(name: string): unknown {
  const text = readFileSync(fixturePath(name), "utf8");
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new LlmError(`fixture ${name} is not parsable JSON`, { cause });
  }
}

// Test-driver privilege: queue committed fixture families by name, served in
// order, one per turn() call.
const turnFixtureQueue: string[] = [];

export function queueTurnFixtures(names: string[]): void {
  turnFixtureQueue.push(...names);
}

// Also clears the recorded calls — the two queues move together between tests.
export function resetTurnFixtures(): void {
  turnFixtureQueue.length = 0;
  recordedTurns.length = 0;
}

// Test-driver observation point: every turn() call's arguments, for asserting
// the retry conversation (docs/04's loop tests).
export interface RecordedTurn {
  messages: ChatMessage[];
  temperature: number;
}

export const recordedTurns: RecordedTurn[] = [];

// Standalone mode (docs/04): sort own (enemy) units by id, take the first,
// compute its reachable tiles with src/game/reach.ts, move to the first
// adjacent free tile (fixed compass order, so the result is deterministic
// given the state) or wait if fully surrounded; all other units omit
// (omission is explicitly legal). Shape per the contract; action wait is
// legal anywhere.
function standaloneTurn(messages: ChatMessage[]): unknown {
  const userMessage = messages.find((message) => message.role === "user");
  const state = userMessage === undefined ? undefined : parseSerializedState(userMessage.content);
  if (state === undefined) return { moves: [] };
  const own = state.units
    .filter((unit) => unit.side === "enemy")
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
  const unit = own[0];
  if (unit === undefined) return { moves: [] };
  const reach = reachableTiles(state.board, state.units, unit, engineConfig);
  const size = engineConfig.boardSize;
  const candidates: Array<[number, number]> = (
    [
      [unit.x + 1, unit.y],
      [unit.x - 1, unit.y],
      [unit.x, unit.y + 1],
      [unit.x, unit.y - 1],
    ] as Array<[number, number]>
  ).filter(([x, y]) => x >= 0 && y >= 0 && x < size && y < size && reach.has(tileKey(x, y)));
  const target = candidates[0];
  const path: Array<[number, number]> =
    target === undefined ? [[unit.x, unit.y]] : [[unit.x, unit.y], target];
  const moves: Move[] = [{ unitId: unit.id, path, action: { type: "wait" } }];
  return { moves };
}

export const mockLlm: LlmClient = {
  chat: () => {
    throw new LlmError("MockLlm.chat is not used by the AI pipeline");
  },

  brief: async () => fixture("brief.valid.json"),

  turn: async ({ messages, temperature }) => {
    recordedTurns.push({ messages, temperature });
    const name = turnFixtureQueue.shift();
    if (name !== undefined) return fixture(name);
    return standaloneTurn(messages);
  },
};
