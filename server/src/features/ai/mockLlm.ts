// Mock LLM client (docs/04): same interface as the real one, returns the
// committed fixture responses. Fixtures are committed, not invented at test
// time — the five families in __fixtures__/ are the contract; phase 4 ships
// the brief fixture (turn fixtures arrive with phase 5). Fixtures are loaded
// as JSON imports (the src/config/config.ts runtime-asset precedent): they
// resolve in src/ AND in the shipped dist/ because tsc copies imported JSON.
import type { LlmClient } from "./llmClient";
import briefValid from "./__fixtures__/brief.valid.json";

export const mockLlm: LlmClient = {
  chat: () => {
    throw new Error("mock chat() arrives with phase 5 (docs/09)");
  },

  brief: async () => structuredClone(briefValid),

  turn: () => {
    throw new Error("mock turn() arrives with phase 5 (docs/09)");
  },
};
