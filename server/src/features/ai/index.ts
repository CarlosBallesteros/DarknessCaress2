import { env } from "../../env";
import type { LlmClient } from "./llmClient";
import { MockLlmClient } from "./mockLlm";
import { RealLlmClient } from "./realLlm";

export function createLlmClient(): LlmClient {
  if (env.LLM_MOCK === "1") {
    return new MockLlmClient();
  }
  return new RealLlmClient();
}

export type { LlmClient } from "./llmClient";
export { LlmError } from "./llmClient";
export { MockLlmClient } from "./mockLlm";
export { RealLlmClient } from "./realLlm";
export { runAiTurnJob, kickOffAiTurn } from "./aiTurn";
export { chooseOrderForUnit } from "./policy";
