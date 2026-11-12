import { describe, expect, it } from "vitest";
import { briefSchema } from "../board/briefSchema";
import { LlmError } from "./llmClient";
import { mockLlm } from "./mockLlm";

describe("mock LlmClient", () => {
  it("brief() serves the committed brief.valid fixture (schema-valid)", async () => {
    const result = await mockLlm.brief({ user: "ignored" });
    expect(briefSchema.safeParse(result).success).toBe(true);
  });

  it("chat() is not used by the AI pipeline", async () => {
    await expect(mockLlm.chat({ messages: [], temperature: 0, schema: {} })).rejects.toThrow(
      LlmError,
    );
  });
});
