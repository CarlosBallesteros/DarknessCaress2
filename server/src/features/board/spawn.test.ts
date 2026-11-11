// Spawn scatter tests (docs/03 test 6): same seed ⇒ identical arrangement
// twice; across ≥ 40 seeds the column sets/orders vary (gaps included) and
// the healer is ALWAYS in the back row.
import { describe, expect, it } from "vitest";
import { engineConfig } from "../../game/engine-config";
import { assembleArmies } from "./spawn";

const playerFrontRow = 13;
const playerBackRow = 14;
const enemyFrontRow = 1;
const enemyBackRow = 0;

describe("spawn scatter", () => {
  it("same seed ⇒ identical arrangement twice", () => {
    expect(assembleArmies(4242, engineConfig)).toEqual(
      assembleArmies(4242, engineConfig),
    );
  });

  it("across ≥ 40 seeds the arrangements vary (gaps included)", () => {
    const arrangements = new Set<string>();
    for (let i = 0; i < 48; i++) {
      const units = assembleArmies(5000 + i * 104729, engineConfig);
      const layout = units
        .filter((unit) => unit.side === "player")
        .map((unit) => `${unit.id}:${unit.x},${unit.y}`)
        .join("|");
      arrangements.add(layout);
    }
    expect(arrangements.size).toBeGreaterThan(1);
  });

  it("healer ALWAYS sits in the back row, on both sides", () => {
    for (let i = 0; i < 48; i++) {
      const units = assembleArmies(5000 + i * 104729, engineConfig);
      for (const healer of units.filter((unit) => unit.class === "healer")) {
        expect([playerBackRow, enemyBackRow]).toContain(healer.y);
      }
    }
  });

  it("places exactly 5 units + 3 gaps per row, inside the 8x2 block, ids unique", () => {
    const units = assembleArmies(20261108, engineConfig);
    expect(units).toHaveLength(20);
    const ids = new Set(units.map((unit) => unit.id));
    expect(ids.size).toBe(20);

    for (const [side, frontRow, backRow] of [
      ["player", playerFrontRow, playerBackRow],
      ["enemy", enemyFrontRow, enemyBackRow],
    ] as const) {
      const sideUnits = units.filter((unit) => unit.side === side);
      expect(sideUnits).toHaveLength(10);
      for (const row of [frontRow, backRow]) {
        const inRow = sideUnits.filter((unit) => unit.y === row);
        expect(inRow).toHaveLength(5);
        const columns = new Set(inRow.map((unit) => unit.x));
        expect(columns.size).toBe(5);
        for (const x of columns) {
          expect(x).toBeGreaterThanOrEqual(4);
          expect(x).toBeLessThanOrEqual(11);
        }
      }
      // Freshly spawned: hp = maxHp, never acted.
      for (const unit of sideUnits) {
        expect(unit.hp).toBe(unit.maxHp);
        expect(unit.acted).toBe(false);
      }
    }
  });

  it("numbers unit ids per class in display order (front group first)", () => {
    const units = assembleArmies(20261108, engineConfig);
    const playerSpearFront = units.find(
      (unit) =>
        unit.side === "player" &&
        unit.class === "spear" &&
        unit.y === playerFrontRow,
    );
    const playerSpearBack = units.find(
      (unit) =>
        unit.side === "player" &&
        unit.class === "spear" &&
        unit.y === playerBackRow,
    );
    expect(playerSpearFront?.id).toBe("P-spear-1");
    expect(playerSpearBack?.id).toBe("P-spear-2");
  });
});
