import { defineConfig } from "@playwright/test";

// The suite drives the composed production stack brought up by global-setup
// (docker compose build + up, server with LLM_MOCK=1). E2E_BASE_URL lets a
// different host port be targeted without touching the suite.
export default defineConfig({
  testDir: ".",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "test-results",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: "only-on-failure",
  },
});
