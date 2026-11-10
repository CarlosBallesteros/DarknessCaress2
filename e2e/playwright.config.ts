import { defineConfig } from "@playwright/test";

// Minimal phase-1 config (docs/09): the full composed-stack setup (webServer,
// LLM_MOCK environment, projects) is built in phase 7.
export default defineConfig({
  testDir: "./specs",
  use: { baseURL: "http://localhost:3000" },
});
