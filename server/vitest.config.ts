import { defineConfig } from "vitest/config";

// Tests never touch the real environment: deterministic env for every suite
// (LLM_MOCK is what docs/04's fixture client will key on from phase 4 on).
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgres://dc:dc@127.0.0.1:5432/darknesscaress",
      JWT_SECRET: "test-only-secret-not-used-for-signing",
      OLLAMA_URL: "http://127.0.0.1:11434",
      OLLAMA_MODEL: "test-model",
      NODE_ENV: "test",
    },
  },
});
