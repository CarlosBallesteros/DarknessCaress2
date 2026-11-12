// Mock LLM client (docs/04): same interface as the real one. Board briefs are
// LLM-driven and served from committed fixtures; move decisions are server-side
// policies (no turn() in the LLM seam).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { LlmClient } from "./llmClient";
import { LlmError } from "./llmClient";

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
  chat: async () => {
    throw new LlmError("MockLlm.chat is not used by the AI pipeline");
  },

  brief: async () => fixture("brief.valid.json"),
};
