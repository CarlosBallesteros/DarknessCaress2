import { readFileSync } from "node:fs";
import { LlmError } from "./llmClient.js";
import type { ChatMessage, LlmClient } from "./llmClient.js";
import { standaloneTurnBundle } from "./standaloneTurn.js";

/**
 * Reads a committed fixture (04: "recorded/fixture JSON responses... The mock
 * serves them by name; their CONTENT is authoring-agent choice"). A fixture
 * that is deliberately unparsable (turn.malformed.json) surfaces as the typed
 * LlmError — exactly what the real client would produce.
 *
 * tsc does not copy .json into dist/, so the URL targets the package-root
 * `src/` — three levels up resolves to the package root both here and from
 * dist/features/ai/, the runtime-asset pattern of src/config/config.ts (the
 * production image ships src/).
 */
function fixture(name: string): unknown {
  const text = readFileSync(
    new URL(`../../../src/features/ai/__fixtures__/${name}`, import.meta.url),
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

/**
 * A test-driver distinction the docs draw explicitly (04, amended): the
 * fixture queue and the coordinate-bound defaults are the VITest/Playwright
 * privilege. A manually-run server (LLM_MOCK=1 in .env, dev) has none of the
 * drivers' environment markers — test-setup sets NODE_ENV=test for the server
 * suite, Vitest also injects VITEST into every in-process run.
 */
function inTestDriver(): boolean {
  return process.env.NODE_ENV === "test" || process.env.VITEST !== undefined;
}

/** The mock client (04): same interface, serves committed fixtures by name. */
export class MockLlm implements LlmClient {
  async chat(): Promise<unknown> {
    throw new LlmError("MockLlm.chat is a phase 5 deliverable");
  }

  async brief(): Promise<unknown> {
    return fixture("brief.valid.json");
  }

  /**
   * Two modes, exactly as 04 amends: queued fixture names (the test-driver
   * queue) are served in order — that behavior is frozen. Under a test driver
   * with an empty queue the valid turn remains the default. Standalone (a
   * manually-run server, no test driver) never serves the coordinate-bound
   * static fixtures: turn() computes the deterministic minimal-legal bundle
   * from the CURRENT game state serialized into the user message.
   */
  async turn(opts: {
    messages: ChatMessage[];
    temperature: number;
  }): Promise<unknown> {
    const name = turnFixtureQueue.shift();
    if (name !== undefined) {
      return fixture(name);
    }
    if (!inTestDriver()) {
      return standaloneTurnBundle(opts.messages);
    }
    return fixture("turn.valid.json");
  }
}
