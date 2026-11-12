import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/game/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/features/*",
                "**/features/**",
                "../features/*",
                "../features/**",
                "../../features/*",
                "../../features/**",
              ],
              message: "server/src/game/ must not import from features/",
            },
          ],
        },
      ],
    },
  },
);
