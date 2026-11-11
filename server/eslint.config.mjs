import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "coverage"] },
  ...tseslint.configs.recommended,
  {
    // docs/01 layout rule: server/src/game is the PURE rules engine — it
    // imports nothing from features/; features import from it, never the reverse.
    files: ["src/game/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/features/**", "features/**"],
              message:
                "src/game is pure (zero I/O, docs/02): it must not import from features/.",
            },
          ],
        },
      ],
    },
  },
);
