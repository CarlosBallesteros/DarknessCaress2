import { describe, expect, it } from "vitest";
import { getConfig, toEngineConfig } from "../../config/config.js";
import { placeArmies, spawnBlockStart, SPAWN_BLOCK_WIDTH } from "./spawn.js";

const cfg = toEngineConfig(getConfig());
const size = cfg.boardSize;
const blockStart = spawnBlockStart(size);
const blockEnd = blockStart + SPAWN_BLOCK_WIDTH - 1; // columns 4-11 at baseline

const unitsOf = (seed: number) => placeArmies(seed, cfg);

describe("placeArmies — the 8×2 spawn blocks with seeded scatter (03)", () => {
  it("same seed ⇒ the exact same arrangement twice", () => {
    expect(unitsOf(20261108)).toEqual(unitsOf(20261108));
  });

  it("20 units, ids <P|E>-<class>-<n> counted per class in display order", () => {
    const units = unitsOf(7);
    expect(units).toHaveLength(20);
    const expectedIds = ["player", "enemy"].flatMap((side) => {
      const prefix = side === "player" ? "P" : "E";
      return [
        `${prefix}-sword-1`,
        `${prefix}-sword-2`,
        `${prefix}-axe-1`,
        `${prefix}-axe-2`,
        `${prefix}-spear-1`,
        `${prefix}-spear-2`,
        `${prefix}-archer-1`,
        `${prefix}-archer-2`,
        `${prefix}-mage-1`,
        `${prefix}-healer-1`,
      ];
    });
    expect(units.map((u) => u.id).sort()).toEqual(expectedIds.sort());
    for (const unit of units) {
      const stats = cfg.classes[unit.class];
      expect(unit.hp).toBe(stats.hp);
      expect(unit.maxHp).toBe(stats.hp);
      expect(unit.acted).toBe(false);
      expect(
        unit.side === "player"
          ? unit.id.startsWith("P-")
          : unit.id.startsWith("E-"),
      ).toBe(true);
    }
  });

  it("healer ALWAYS in the back row; front holds swords, axes and the first spear", () => {
    for (let seed = 1; seed <= 40; seed++) {
      for (const side of ["player", "enemy"] as const) {
        const sideUnits = unitsOf(seed).filter((u) => u.side === side);
        const frontRow = side === "player" ? size - 2 : 1;
        const backRow = side === "player" ? size - 1 : 0;
        const front = sideUnits.filter((u) => u.y === frontRow);
        const back = sideUnits.filter((u) => u.y === backRow);

        expect(
          sideUnits.every((u) => u.y === frontRow || u.y === backRow),
        ).toBe(true);
        expect(
          sideUnits.every((u) => u.x >= blockStart && u.x <= blockEnd),
        ).toBe(true);
        expect(front).toHaveLength(5);
        expect(back).toHaveLength(5);
        // 8 slots, 5 units ⇒ exactly 3 empty gaps per row
        const frontColumns = front.map((u) => u.x);
        const backColumns = back.map((u) => u.x);
        expect(SPAWN_BLOCK_WIDTH - frontColumns.length).toBe(3);
        expect(SPAWN_BLOCK_WIDTH - backColumns.length).toBe(3);
        expect(new Set(frontColumns).size).toBe(5);
        expect(new Set(backColumns).size).toBe(5);

        const count = (list: typeof front, cls: string) =>
          list.filter((u) => u.class === cls).length;
        expect(count(front, "sword")).toBe(2);
        expect(count(front, "axe")).toBe(2);
        expect(count(front, "spear")).toBe(1);
        expect(count(back, "spear")).toBe(1);
        expect(count(back, "archer")).toBe(2);
        expect(count(back, "mage")).toBe(1);
        expect(count(back, "healer")).toBe(1);
        // THE rule: the healer never sits front
        expect(front.some((u) => u.class === "healer")).toBe(false);
        // no spawn ever stands on an occupied tile
        expect(new Set(sideUnits.map((u) => `${u.x},${u.y}`)).size).toBe(10);
      }
    }
  });

  it("across 40 seeds the arrangements vary and the sides scatter independently", () => {
    const arrangements = new Set<string>();
    const playerFronts = new Set<string>();
    const enemyFronts = new Set<string>();
    let mirrored = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const units = unitsOf(seed);
      arrangements.add(units.map((u) => `${u.id}@${u.x},${u.y}`).join("|"));
      const frontOf = (side: string, row: number) =>
        units
          .filter((u) => u.side === side && u.y === row)
          .map((u) => u.x)
          .join(",");
      const playerFront = frontOf("player", size - 2);
      const enemyFront = frontOf("enemy", 1);
      playerFronts.add(playerFront);
      enemyFronts.add(enemyFront);
      if (playerFront === enemyFront) {
        mirrored += 1;
      }
    }
    // different games likely look different (gaps included)
    expect(arrangements.size).toBeGreaterThanOrEqual(39);
    expect(playerFronts.size).toBeGreaterThan(1);
    expect(enemyFronts.size).toBeGreaterThan(1);
    // sides scatter independently — no mirror-image symmetry
    expect(mirrored).toBeLessThan(40);
  });
});
