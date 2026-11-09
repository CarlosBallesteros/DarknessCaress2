import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(new URL("./config.json", import.meta.url), "utf8") as string,
) as Record<string, unknown>;

type ClassConfig = {
  count: number;
  hp: number;
  atk: number;
  def: number;
  mov: number;
  range: number[];
  role: string;
  label: string;
  healAmount?: number;
};

const classes = config.classes as Record<string, ClassConfig>;

describe("config.json", () => {
  it("honors the canonical 01 shape", () => {
    expect(Object.keys(config).sort()).toEqual(
      [
        "ai",
        "classes",
        "lore",
        "maxActiveGames",
        "boardSize",
        "personalities",
        "themes",
      ].sort(),
    );
  });

  it("carries the 00 stat values", () => {
    expect(config.boardSize).toBe(15);
    expect(config.maxActiveGames).toBe(5);
    expect(classes.sword).toMatchObject({
      count: 2,
      hp: 20,
      atk: 7,
      def: 5,
      mov: 3,
      range: [1],
      role: "attacker",
      label: "Swordsman",
    });
    expect(classes.axe).toMatchObject({
      count: 2,
      hp: 25,
      atk: 10,
      def: 3,
      mov: 2,
      range: [1],
      role: "attacker",
      label: "Axeman",
    });
    expect(classes.spear).toMatchObject({
      count: 2,
      hp: 18,
      atk: 6,
      def: 3,
      mov: 5,
      range: [1],
      role: "attacker",
      label: "Spearman",
    });
    expect(classes.archer).toMatchObject({
      count: 2,
      hp: 16,
      atk: 6,
      def: 2,
      mov: 4,
      range: [2],
      role: "supporter",
      label: "Archer",
    });
    expect(classes.mage).toMatchObject({
      count: 1,
      hp: 15,
      atk: 8,
      def: 1,
      mov: 3,
      range: [1, 2, 3],
      role: "supporter",
      label: "Mage",
    });
    expect(classes.healer).toMatchObject({
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

  it("defines the three difficulty personas with their temperatures", () => {
    const personalities = config.personalities as Record<
      string,
      { label: string; temperature: number }
    >;
    expect(personalities.aggressive.temperature).toBe(0.7);
    expect(personalities.defensive.temperature).toBe(0.4);
    expect(personalities.erratic.temperature).toBe(1.2);
  });

  it("defines the AI retry knobs", () => {
    const ai = config.ai as Record<string, unknown>;
    expect(ai.moveRetries).toBe(3);
    expect(ai.staleAfterSeconds).toBe(60);
    expect(ai.briefTemperature).toBe(0.8);
    expect(ai.boardRetries).toEqual({ materializations: 3, briefs: 3 });
  });

  it("ships the baseline theme and placeholder lore for every class", () => {
    const themes = config.themes as Array<{ id: string; label: string }>;
    expect(themes).toEqual([
      { id: "warriors-europe", label: "Champions of Europe" },
    ]);
    const lore = config.lore as Record<string, string>;
    for (const classKey of Object.keys(classes)) {
      expect(lore[classKey]).toBeTruthy();
    }
  });
});
