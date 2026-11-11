import { defineConfig, devices } from "@playwright/test";

// Phase 1 scaffold: config only — the E2E suite itself is built in phase 7
// (docs/09) against the fully composed stack.
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    ...devices["Desktop Chrome"],
  },
});
