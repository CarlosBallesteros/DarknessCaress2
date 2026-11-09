import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/test-setup.ts"],
    // 04: the test runners inject LLM_MOCK=1 automatically — every automated
    // run is mocked by definition; no real Ollama call happens in tests.
    env: { LLM_MOCK: "1" },
    // The suite shares one Postgres database; parallel files would race the
    // idempotent migration on a fresh database (CREATE EXTENSION race).
    fileParallelism: false,
  },
});
