import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Root config: covers the top-level e2e/ package (the workspace packages ship
// their own configs next to their sources).
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "coverage",
      "playwright-report",
      "test-results",
      "client/public/assets",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
);
