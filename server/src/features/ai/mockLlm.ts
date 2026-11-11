// Mock LLM client (docs/04): same interface as the real one, returns the
// committed fixture responses. Fixtures are committed, not invented at test
// time — the five families in __fixtures__/ are the contract (brief.valid,
// turn.valid, turn.malformed, turn.illegal, turn.exhausting); their CONTENT is
// authoring-agent choice, the NAMES are not. turn.malformed.json is
// deliberately UNparsable JSON, so fixtures are loaded as text and parsed —
// an unparsable fixture surfaces as the typed LlmError, exactly what the real
// client produces, and the caller counts it as a failed attempt, never a
// crashed process.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmClient } from "./llmClient";
import { LlmError, type ChatMessage } from "./llmClient";
import { standaloneTurnBundle } from "./standalone-turn";

// Anchored at this module's directory (available both in src/ under the test
// runners and in the compiled dist/, where the image ships the package's src/
// tree as fallback — tsc only copies JSON it imports, and malformed JSON
// cannot be imported).
function fixturePath(name: string): string {
  const local = join(__dirname, "__fixtures__", name);
  if (existsSync(local)) return local;
  return join(
    __dirname,
    "..",
    "..",
    "..",
    "src",
    "features",
    "ai",
    "__fixtures__",
    name,
  );
}

function fixture(name: string): unknown {
  const text = readFileSync(fixturePath(name), "utf8");
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new LlmError(`fixture ${name} is not parsable JSON`, { cause });
  }
}

// Queue of fixture names served by subsequent mock turn() calls (docs/04: the
// mock serves fixtures by name). Tests queue a sequence — e.g. malformed once
// then valid — and the retry/exhaustion tests consume exactly the committed
// families. With nothing queued the behavior follows the mode below.
const turnFixtureQueue: string[] = [];

export function queueTurnFixtures(...names: string[]): void {
  turnFixtureQueue.push(...names);
}

export function resetTurnFixtures(): void {
  turnFixtureQueue.length = 0;
}

// A test-driver distinction the docs draw explicitly (docs/04): the fixture
// queue is the Vitest/Playwright privilege. A manually-run server (LLM_MOCK=1
// in .env, dev) has none of the drivers' environment markers.
function inTestDriver(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST !== undefined;
}

export const mockLlm: LlmClient = {
  chat: () => {
    throw new LlmError("MockLlm.chat is not used by the AI pipeline");
  },

  brief: async () => fixture("brief.valid.json"),

  // Two modes, exactly as docs/04 defines: queued fixture names are served in
  // order; under a test driver with an empty queue the valid turn is the
  // default; standalone (a manually-run server) computes the deterministic
  // minimal-legal bundle from the CURRENT game state instead — the
  // coordinate-bound static fixtures must never be served against live
  // scattered boards.
  turn: async ({ messages }: { messages: ChatMessage[] }) => {
    const name = turnFixtureQueue.shift();
    if (name !== undefined) return fixture(name);
    if (!inTestDriver()) return standaloneTurnBundle(messages);
    return fixture("turn.valid.json");
  },
};
