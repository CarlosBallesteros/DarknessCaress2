import { describe, expect, it } from "vitest";
import { config } from "./load";

// Phase 1 guard: the config file loads and matches the canonical shape and the
// stat values fixed in docs/00 (balance tuning later happens only in this file).
describe("config.json", () => {
  it("has the fixed board and games-cap values", () => {
    expect(config.boardSize).toBe(8);
    expect(config.maxActiveGames).toBe(5);
  });

  it("carries the 6 baseline classes with the docs/00 stat table", () => {
    expect(Object.keys(config.classes).sort()).toEqual(
      ["archer", "axe", "healer", "mage", "spear", "sword"].sort(),
    );

    expect(config.classes.sword).toMatchObject({
      count: 2,
      hp: 20,
      atk: 7,
      def: 5,
      mov: 3,
      range: [1],
      role: "attacker",
    });
    expect(config.classes.axe).toMatchObject({
      count: 2,
      hp: 25,
      atk: 10,
      def: 3,
      mov: 2,
      range: [1],
      role: "attacker",
    });
    expect(config.classes.spear).toMatchObject({
      count: 2,
      hp: 18,
      atk: 6,
      def: 3,
      mov: 5,
      range: [1],
      role: "attacker",
    });
    expect(config.classes.archer).toMatchObject({
      count: 2,
      hp: 16,
      atk: 6,
      def: 2,
      mov: 4,
      range: [2],
      role: "supporter",
    });
    expect(config.classes.mage).toMatchObject({
      count: 1,
      hp: 15,
      atk: 8,
      def: 1,
      mov: 3,
      range: [1, 2, 3],
      role: "supporter",
    });
    expect(config.classes.healer).toMatchObject({
      count: 1,
      hp: 18,
      atk: 0,
      def: 2,
      mov: 2,
      range: [],
      healAmount: 8,
      role: "supporter",
    });
  });

  it("has the 3 difficulty personalities and the single baseline theme", () => {
    expect(Object.keys(config.personalities).sort()).toEqual(
      ["aggressive", "defensive", "erratic"].sort(),
    );
    expect(config.personalities.erratic.temperature).toBe(1.2);
    expect(config.themes).toEqual([{ id: "warriors-europe", label: "Champions of Europe" }]);
  });

  it("has placeholder lore for every class", () => {
    for (const key of Object.keys(config.classes)) {
      expect(config.lore[key]).toBeTruthy();
    }
  });

  it("has the AI retry knobs from docs/01", () => {
    expect(config.ai).toMatchObject({
      moveRetries: 3,
      staleAfterSeconds: 60,
      sweepIntervalSeconds: 15,
      briefTemperature: 0.8,
      boardRetries: { materializations: 3, briefs: 3 },
    });
  });
});
