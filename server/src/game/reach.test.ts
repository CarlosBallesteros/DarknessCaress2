import { describe, expect, it } from "vitest";
import { isPathLegal, previewMove, reachableTiles } from "./reach";
import { SIZE, type Board, type ClassKey, type Side, type Tile, type Unit } from "./types";
import { engineConfig } from "../config/engine";

// Parametrized with the REAL config values (docs/02): expectations derive from
// engineConfig, so rebalancing config.json re-validates the engine by rerunning.
const CFG = engineConfig;

let nextId = 0;
function unit(
  classKey: ClassKey,
  side: Side,
  x: number,
  y: number,
  overrides: Partial<Unit> = {},
): Unit {
  const cls = CFG.classes[classKey];
  return {
    id: `u${nextId++}`,
    side,
    class: classKey,
    x,
    y,
    hp: cls.hp,
    maxHp: cls.hp,
    acted: false,
    ...overrides,
  };
}

function board(entries: Array<[x: number, y: number, tile: Tile]> = []): Board {
  const tiles: Tile[][] = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => "plain" as Tile),
  );
  for (const [x, y, tile] of entries) tiles[y][x] = tile;
  return { tiles };
}

describe("reachableTiles", () => {
  it("reaches straight movement up to Mov on an open board (diamond)", () => {
    const b = board();
    const sword = unit("sword", "player", 7, 7);
    const reach = reachableTiles(b, [sword], sword, CFG);
    const m = CFG.classes.sword.mov;
    // diamond of radius m: 2m² + 2m + 1 tiles (own tile included)
    expect(reach.size).toBe(2 * m * m + 2 * m + 1);
    expect(reach.has("7,7")).toBe(true); // own tile — the Wait entry
    expect(reach.has(`7,${7 - m}`)).toBe(true);
    expect(reach.has(`${7 + m},7`)).toBe(true);
    expect(reach.has(`7,${7 + m}`)).toBe(true);
    expect(reach.has(`7,${7 - m - 1}`)).toBe(false);
    expect(reach.has(`${7 + m + 1},7`)).toBe(false);
  });

  it("is blocked by an enemy unit (cannot enter or pass through)", () => {
    const b = board();
    const sword = unit("sword", "player", 7, 7);
    const enemy = unit("sword", "enemy", 7, 6);
    const reach = reachableTiles(b, [sword, enemy], sword, CFG);
    expect(reach.has("7,6")).toBe(false); // enemy tile
    expect(reach.has("7,5")).toBe(false); // behind the enemy
    expect(reach.has("8,6")).toBe(true); // around the enemy is fine
  });

  it("passes through allies but cannot end on their tile", () => {
    const b = board();
    const sword = unit("sword", "player", 7, 7);
    const ally = unit("axe", "player", 7, 6);
    const reach = reachableTiles(b, [sword, ally], sword, CFG);
    expect(reach.has("7,6")).toBe(false); // occupied — not standable
    expect(reach.has("7,5")).toBe(true); // passed through the ally
  });

  it("blocks water except bridge", () => {
    const river = unit("sword", "player", 7, 7);
    const reachRiver = reachableTiles(board([[7, 6, "river"]]), [river], river, CFG);
    expect(reachRiver.has("7,6")).toBe(false);
    expect(reachRiver.has("7,5")).toBe(false);

    const lake = unit("sword", "player", 7, 7);
    const reachLake = reachableTiles(board([[7, 6, "lake"]]), [lake], lake, CFG);
    expect(reachLake.has("7,6")).toBe(false);
    expect(reachLake.has("7,5")).toBe(false); // only reachable through the lake

    const bridge = unit("sword", "player", 7, 7);
    const reachBridge = reachableTiles(board([[7, 6, "bridge"]]), [bridge], bridge, CFG);
    expect(reachBridge.has("7,6")).toBe(true);
    expect(reachBridge.has("7,5")).toBe(true);
  });
});

describe("isPathLegal", () => {
  it("accepts a straight path up to Mov edges", () => {
    const b = board();
    const sword = unit("sword", "player", 7, 7);
    const path: Array<[number, number]> = [
      [7, 7],
      [7, 6],
      [7, 5],
      [7, 4],
    ];
    expect(isPathLegal(b, [sword], sword, path, CFG)).toBeNull();
  });

  it("accepts the 1-entry Wait path at the unit's own tile", () => {
    const b = board();
    const sword = unit("sword", "player", 7, 7);
    expect(isPathLegal(b, [sword], sword, [[7, 7]], CFG)).toBeNull();
  });

  it("rejects a path not starting at the unit's tile", () => {
    const b = board();
    const sword = unit("sword", "player", 7, 7);
    expect(isPathLegal(b, [sword], sword, [[7, 6]], CFG)).toBe(
      "path must start at the unit's tile",
    );
  });

  it("rejects a diagonal step", () => {
    const b = board();
    const sword = unit("sword", "player", 7, 7);
    expect(
      isPathLegal(
        b,
        [sword],
        sword,
        [
          [7, 7],
          [8, 6],
        ],
        CFG,
      ),
    ).toBe("path step (8,6) is not adjacent to the previous step");
  });

  it("rejects steps outside the board (size from config)", () => {
    const b = board();
    const spear = unit("spear", "player", 7, 12);
    const edge = CFG.boardSize;
    expect(
      isPathLegal(
        b,
        [spear],
        spear,
        [
          [7, 12],
          [7, 13],
          [7, 14],
          [7, 15],
        ],
        CFG,
      ),
    ).toBe(`path step (7,${edge}) is outside the board`);
  });

  it("rejects water steps", () => {
    const b = board([[7, 6, "river"]]);
    const sword = unit("sword", "player", 7, 7);
    expect(
      isPathLegal(
        b,
        [sword],
        sword,
        [
          [7, 7],
          [7, 6],
        ],
        CFG,
      ),
    ).toBe("path step (7,6) is water");
  });

  it("rejects entering an enemy-occupied tile", () => {
    const b = board();
    const sword = unit("sword", "player", 7, 7);
    const enemy = unit("axe", "enemy", 7, 6);
    expect(
      isPathLegal(
        b,
        [sword, enemy],
        sword,
        [
          [7, 7],
          [7, 6],
        ],
        CFG,
      ),
    ).toBe("path enters an enemy unit at (7,6)");
  });

  it("rejects a path longer than Mov with the edges count", () => {
    const b = board();
    const sword = unit("sword", "player", 7, 7);
    const path: Array<[number, number]> = [
      [7, 7],
      [7, 6],
      [7, 5],
      [7, 4],
      [7, 3],
    ];
    expect(isPathLegal(b, [sword], sword, path, CFG)).toBe(
      `path length 4 exceeds movement ${CFG.classes.sword.mov}`,
    );
  });

  it("rejects ending on an occupied tile", () => {
    const b = board();
    const sword = unit("sword", "player", 7, 7);
    const ally = unit("axe", "player", 7, 6);
    expect(
      isPathLegal(
        b,
        [sword, ally],
        sword,
        [
          [7, 7],
          [7, 6],
        ],
        CFG,
      ),
    ).toBe("path ends on an occupied tile");
  });
});

describe("previewMove", () => {
  it("matches reachable tiles and lists exactly the attackable enemy tiles", () => {
    const b = board();
    const sword = unit("sword", "player", 5, 7); // mov 3, range [1]
    const archerEnemy = unit("archer", "enemy", 5, 10); // 3 away — attackable via final (5,9)
    const axeEnemy = unit("axe", "enemy", 8, 7); // 3 away — attackable via final (7,7)
    const farEnemy = unit("axe", "enemy", 12, 7); // 7 away — never reachable in range
    const preview = previewMove(b, [sword, archerEnemy, axeEnemy, farEnemy], sword, CFG);

    expect(new Set(preview.moveTiles.map(([x, y]) => `${x},${y}`))).toEqual(
      reachableTiles(b, [sword, archerEnemy, axeEnemy, farEnemy], sword, CFG),
    );
    expect(new Set(preview.attackTiles.map(([x, y]) => `${x},${y}`))).toEqual(
      new Set(["5,10", "8,7"]),
    );
  });

  it("uses range-list membership, not ≤ max (archer is exactly 2)", () => {
    const b = board();
    const archer = unit("archer", "player", 5, 7); // mov 4, range [2]
    const twoAway = unit("sword", "enemy", 5, 9); // 2 away from the origin — attackable
    const unreachableCorner = unit("axe", "enemy", 14, 14); // no reachable final tile gets in range
    const preview = previewMove(b, [archer, twoAway, unreachableCorner], archer, CFG);
    expect(new Set(preview.attackTiles.map(([x, y]) => `${x},${y}`))).toEqual(new Set(["5,9"]));
  });

  it("lists wounded same-side allies for a healer, not full-hp ones, and no attack tiles", () => {
    const b = board();
    const healer = unit("healer", "player", 5, 7);
    const wounded = unit("sword", "player", 6, 7, { hp: CFG.classes.sword.hp - 5 });
    const fullHp = unit("axe", "player", 5, 5);
    const enemy = unit("axe", "enemy", 8, 7);
    const preview = previewMove(b, [healer, wounded, fullHp, enemy], healer, CFG);
    expect(new Set(preview.healTiles.map(([x, y]) => `${x},${y}`))).toEqual(new Set(["6,7"]));
    expect(preview.attackTiles).toEqual([]); // healer's range list is empty
  });
});
