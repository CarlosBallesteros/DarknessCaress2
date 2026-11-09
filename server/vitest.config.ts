import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/test-setup.ts"],
    // The suite shares one Postgres database; parallel files would race the
    // idempotent migration on a fresh database (CREATE EXTENSION race).
    fileParallelism: false,
  },
});
