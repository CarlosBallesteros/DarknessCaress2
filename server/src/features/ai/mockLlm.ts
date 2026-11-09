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

/**
 * Queue of fixture names served by subsequent MockLlm.turn() calls (04: the
 * mock serves fixtures by name). Tests queue a sequence — e.g. malformed once
 * then valid — and the retry/exhaustion tests consume exactly the committed
 * families; with nothing queued every turn is turn.valid.json.
 */
const turnFixtureQueue: string[] = [];

export function queueTurnFixtures(...names: string[]): void {
  turnFixtureQueue.push(...names);
}

export function resetTurnFixtures(): void {
  turnFixtureQueue.length = 0;
}

/** The mock client (04): same interface, serves committed fixtures by name. */
export class MockLlm implements LlmClient {
  async chat(): Promise<unknown> {
    throw new LlmError("MockLlm.chat is a phase 5 deliverable");
  }

  async brief(): Promise<unknown> {
    return fixture("brief.valid.json");
  }

  /** Serves the queued fixture names in order; defaults to the valid turn. */
  async turn(): Promise<unknown> {
    const name = turnFixtureQueue.shift() ?? "turn.valid.json";
    return fixture(name);
  }
}
