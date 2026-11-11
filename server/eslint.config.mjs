import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // docs/01 layout rule: src/game/ is the PURE rules engine — it imports
    // nothing from features/ and performs zero I/O. Test files are exempt (the
    // engine tests themselves may read config files); the boundary guards the
    // engine modules.
    files: ["src/game/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/features",
                "**/features/**",
                "../features",
                "../features/**",
                "**/db",
                "**/db/**",
                "../db",
                "../db/**",
                "**/config",
                "**/config/**",
                "../config",
                "../config/**",
                "node:fs",
                "node:fs/promises",
                "node:http",
                "node:https",
                "node:net",
                "node:dgram",
                "node:child_process",
                "node:stream",
                "pg",
                "express",
              ],
              message:
                "src/game is the pure rules engine: no features/db/config imports, zero I/O (docs/01, docs/02).",
            },
          ],
        },
      ],
    },
  },
);
