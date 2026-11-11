import { defineConfig } from "vitest/config";

// Test-only env (docs/01): unit tests never touch a real Ollama or the deployed
// database; DATABASE_URL points at the loopback-postgres from the dev override.
// LLM_MOCK=1 is injected automatically (docs/04): every automated run is mocked.
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgres://dc:dc@127.0.0.1:5432/darknesscaress",
      JWT_SECRET: "test-secret",
      OLLAMA_URL: "http://localhost:11434",
      OLLAMA_MODEL: "test-model",
      LLM_MOCK: "1",
    },
  },
});
