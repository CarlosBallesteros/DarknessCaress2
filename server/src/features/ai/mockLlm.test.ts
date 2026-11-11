// Mock client contract (docs/04): the committed fixtures load through the
// runtime-asset pattern, brief() serves the committed valid brief, and the
// test runners' LLM_MOCK=1 selects the mock — never a live Ollama in tests.
import { describe, expect, it } from "vitest";
import { env } from "../../env";
import { briefSchema } from "../board/briefSchema";
import { briefPrompt } from "../board/briefPrompt";
import { getLlmClient, LlmError, ollamaLlm } from "./llmClient";
import { mockLlm } from "./mockLlm";

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

  it("turn() is a phase-5 stub on both implementations", () => {
    // The stub throws synchronously before any promise exists.
    expect(() => mockLlm.turn({ messages: [], temperature: 0.5 })).toThrow(LlmError);
    expect(() => ollamaLlm.turn({ messages: [], temperature: 0.5 })).toThrow(LlmError);
  });
});
