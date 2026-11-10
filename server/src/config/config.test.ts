import { describe, expect, it } from "vitest";
import { config } from "./config";

// Canonical shape + baseline values per docs/01 (shape) and docs/00 (stats).
describe("config", () => {
  it("carries the canonical board size and games cap", () => {
    expect(config.boardSize).toBe(15);
    expect(config.maxActiveGames).toBe(5);
  });

  it("carries the docs/00 stat table for exactly the six baseline classes", () => {
    expect(Object.keys(config.classes).sort()).toEqual([
      "archer",
      "axe",
      "healer",
      "mage",
      "spear",
      "sword",
    ]);
    expect(config.classes.sword).toEqual({
      count: 2,
      hp: 20,
      atk: 7,
      def: 5,
      mov: 3,
      range: [1],
      role: "attacker",
      label: "Swordsman",
    });
    expect(config.classes.axe).toEqual({
      count: 2,
      hp: 25,
      atk: 10,
      def: 3,
      mov: 2,
      range: [1],
      role: "attacker",
      label: "Axeman",
    });
    expect(config.classes.spear).toEqual({
      count: 2,
      hp: 18,
      atk: 6,
      def: 3,
      mov: 5,
      range: [1],
      role: "attacker",
      label: "Spearman",
    });
    expect(config.classes.archer).toEqual({
      count: 2,
      hp: 16,
      atk: 6,
      def: 2,
      mov: 4,
      range: [2],
      role: "supporter",
      label: "Archer",
    });
    expect(config.classes.mage).toEqual({
      count: 1,
      hp: 15,
      atk: 8,
      def: 1,
      mov: 3,
      range: [1, 2, 3],
      role: "supporter",
      label: "Mage",
    });
    expect(config.classes.healer).toEqual({
      count: 1,
      hp: 18,
      atk: 0,
      def: 2,
      mov: 2,
      range: [],
      healAmount: 8,
      role: "supporter",
      label: "Healer",
    });
  });

  it("carries the three difficulty personas with their temperatures", () => {
    expect(config.personalities).toEqual({
      aggressive: { label: "Aggressive", temperature: 0.7 },
      defensive: { label: "Defensive", temperature: 0.4 },
      erratic: { label: "Erratic", temperature: 1.2 },
    });
  });

  it("ships exactly the one MVP theme", () => {
    expect(config.themes).toEqual([
      { id: "warriors-europe", label: "Champions of Europe" },
    ]);
  });

  it("has placeholder lore for every class (drafted for real in phase 6)", () => {
    expect(Object.keys(config.lore).sort()).toEqual([
      "archer",
      "axe",
      "healer",
      "mage",
      "spear",
      "sword",
    ]);
    for (const text of Object.values(config.lore)) {
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("carries the AI retry knobs", () => {
    expect(config.ai).toEqual({
      moveRetries: 3,
      staleAfterSeconds: 60,
      briefTemperature: 0.8,
      boardRetries: { materializations: 3, briefs: 3 },
    });
  });
});
