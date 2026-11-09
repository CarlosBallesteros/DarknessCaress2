import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 01: "server/src/game/ is pure and imports nothing from features; features
// import from src/game; nothing imports upward." Zero I/O means no node
// built-ins and no packages either — the production engine modules may only
// import each other, relatively.

const ENGINE_MODULES = ["types.ts", "reach.ts", "apply.ts"];

const importedSpecifiers = (source: string): string[] =>
  [...source.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1] as string);

const gameDir = new URL(".", import.meta.url);

describe("engine import boundary (01: src/game stays pure and downward-only)", () => {
  it("src/game holds the production modules 02's headings define", () => {
    const files = readdirSync(gameDir);
    for (const file of ENGINE_MODULES) {
      expect(files).toContain(file);
    }
  });

  for (const file of ENGINE_MODULES) {
    it(`${file} imports only sibling engine modules — no features/, no node:, no packages`, () => {
      const source = readFileSync(new URL(`./${file}`, gameDir), "utf8");
      const specifiers = importedSpecifiers(source);
      for (const specifier of specifiers) {
        expect(specifier.startsWith("./")).toBe(true);
        expect(specifier).not.toContain("features");
      }
    });
  }

  it("the engine never references the config file or loader (02: it is projected)", () => {
    for (const file of ENGINE_MODULES) {
      const source = readFileSync(new URL(`./${file}`, gameDir), "utf8");
      expect(source).not.toContain("getConfig");
      for (const specifier of importedSpecifiers(source)) {
        expect(specifier).not.toContain("config");
      }
    }
  });
});
