import { defineConfig } from "vitest/config";

// Test-only env (docs/01): unit tests never touch a real Ollama or the deployed
// database; DATABASE_URL points at the loopback-postgres from the dev override.
export default defineConfig({
  test: {
    env: {
      DATABASE_URL: "postgres://dc:dc@127.0.0.1:5432/darknesscaress",
      JWT_SECRET: "test-secret",
      OLLAMA_URL: "http://localhost:11434",
      OLLAMA_MODEL: "test-model",
    },
  },
});
