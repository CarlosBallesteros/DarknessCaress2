import { readFileSync } from "node:fs";
import { LlmError } from "./llmClient.js";
import type { LlmClient } from "./llmClient.js";

/**
 * Reads a committed fixture (04: "recorded/fixture JSON responses... The mock
 * serves them by name; their CONTENT is authoring-agent choice"). A fixture
 * that is deliberately unparsable (turn.malformed.json) surfaces as the typed
 * LlmError — exactly what the real client would produce.
 */
function fixture(name: string): unknown {
  const text = readFileSync(
    new URL(`./__fixtures__/${name}`, import.meta.url),
    "utf8",
  );
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new LlmError(`fixture ${name} is not parsable JSON`, { cause: err });
  }
}

/** The mock client (04): same interface, serves committed fixtures. */
export class MockLlm implements LlmClient {
  async chat(): Promise<unknown> {
    throw new LlmError("MockLlm.chat is a phase 5 deliverable");
  }

  async brief(): Promise<unknown> {
    return fixture("brief.valid.json");
  }

  async turn(): Promise<unknown> {
    throw new LlmError("MockLlm.turn is a phase 5 deliverable");
  }
}
