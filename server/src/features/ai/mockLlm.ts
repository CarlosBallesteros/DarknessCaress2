// Mock LLM client (docs/04): same interface as the real one, returns the
// committed fixture responses. Fixtures are committed, not invented at test
// time — the five families in __fixtures__/ are the contract (brief.valid,
// turn.valid, turn.malformed, turn.illegal, turn.exhausting); their CONTENT is
// authoring-agent choice, the NAMES are not. turn.malformed.json is
// deliberately UNparsable JSON, so fixtures are loaded as text and parsed —
// an unparsable fixture surfaces as the typed LlmError, exactly what the real
// client produces, and the caller counts it as a failed attempt, never a
// crashed process. Phase 4 consumes brief() only; turn() is a phase-5 stub.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmClient } from "./llmClient";
import { LlmError } from "./llmClient";

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

export const mockLlm: LlmClient = {
  chat: () => {
    throw new LlmError("MockLlm.chat is not used by the AI pipeline");
  },

  brief: async () => fixture("brief.valid.json"),

  // Phase 5 owns the turn call: queued fixture families + the standalone
  // deterministic minimal-legal bundle (docs/04). The stub keeps the
  // interface honest until then.
  turn: () => {
    throw new LlmError("turn() is implemented in phase 5");
  },
};
