import { defineConfig } from "vitest/config";

// Tests never touch the real environment: deterministic env for every suite.
// LLM_MOCK=1 is injected automatically per docs/04 — every automated run is
// mocked by definition, never a live Ollama.
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgres://dc:dc@127.0.0.1:5432/darknesscaress",
      JWT_SECRET: "test-only-secret-not-used-for-signing",
      OLLAMA_URL: "http://127.0.0.1:11434",
      OLLAMA_MODEL: "test-model",
      LLM_MOCK: "1",
      NODE_ENV: "test",
    },
  },
});
