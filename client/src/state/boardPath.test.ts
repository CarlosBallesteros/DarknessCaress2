import { describe, expect, it } from "vitest";
import type { MoveSubmission, Unit, XY } from "../types/api";
import { localPreview, manhattan, shortestPath } from "./boardPath";

const grid = (size: number): [number, number][] => {
  const tiles: [number, number][] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      tiles.push([x, y]);
    }
  }
  return tiles;
};

describe("manhattan", () => {
  it("measures axis distance", () => {
    expect(manhattan([1, 2], [4, 6])).toBe(7);
    expect(manhattan([3, 3], [3, 3])).toBe(0);
  });
});

describe("shortestPath — the path-SERIALIZING helper (05)", () => {
  it("returns [from] when destination is the current tile (wait in place)", () => {
    expect(shortestPath(grid(3), [], [1, 1], [1, 1])).toEqual([[1, 1]]);
  });

  it("finds a straight 4-neighbour path inclusive of both ends", () => {
    const path = shortestPath(grid(3), [], [0, 0], [2, 0]);
    expect(path).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it("detours around a hole in the reachable set", () => {
    const tiles = grid(3).filter(([x, y]) => !(x === 1 && y === 0));
    const path = shortestPath(tiles, [], [0, 0], [2, 0]);
    expect(path).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
      [2, 0],
    ]);
  });

  it("routes THROUGH pass-through tiles (allies) but never onto them", () => {
    // ally at (1,0): not finalizable, but the corridor past it is reachable.
    const tiles: XY[] = [
      [2, 0],
      [3, 0],
    ];
    const path = shortestPath(tiles, [[1, 0]], [0, 0], [2, 0]);
    expect(path).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it("rejects a destination outside moveTiles", () => {
    expect(shortestPath([[1, 0]], [], [0, 0], [2, 0])).toBeNull();
  });

  it("returns null when the destination is only reachable across an enemy-blocked gap", () => {
    const tiles: XY[] = [
      [2, 0],
      [3, 0],
    ];
    expect(shortestPath(tiles, [], [0, 0], [3, 0])).toBeNull();
  });
});

// ---- localPreview: the client BFS over the DERIVED (ghost-applied) occupancy

const unit = (
  id: string,
  side: "player" | "enemy",
  x: number,
  y: number,
  hp = 10,
  maxHp = 10,
): Unit => ({
  id,
  side,
  class: id.includes("healer") ? "healer" : "sword",
  x,
  y,
  hp,
  maxHp,
  acted: false,
});

const PLAIN_ROW = ["plain", "plain", "plain", "plain", "plain"];

const base = {
  boardSize: 5,
  mov: 2,
  range: [1] as number[],
  canHeal: false,
  tiles: [PLAIN_ROW, PLAIN_ROW, PLAIN_ROW, PLAIN_ROW, PLAIN_ROW],
};

const asSet = (tiles: Array<[number, number]>): string =>
  tiles
    .map(([x, y]) => `${x},${y}`)
    .sort()
    .join(" ");

describe("localPreview — ghost-applied recompute (05)", () => {
  it("with nothing staged it mirrors the engine's reach: own tile included, allies passable but not landable, enemies block", () => {
    const units = [
      unit("P-sword-1", "player", 0, 0),
      unit("P-axe-1", "player", 1, 0), // pass-through ally
      unit("E-axe-1", "enemy", 0, 2), // blocks passage down the column
    ];
    const preview = localPreview({
      ...base,
      units,
      unitId: "P-sword-1",
      staged: [],
    });
    // mov 2 from (0,0): (1,0) reached but ally-occupied (no END); (0,2) enemy-blocked
    expect(asSet(preview.moveTiles)).toBe("0,0 0,1 1,1 2,0");
    // enemy at (0,2) is Manhattan 1 from the reachable (0,1) → in range [1]
    expect(asSet(preview.attackTiles)).toBe("0,2");
    expect(preview.healTiles).toEqual([]);
  });

  it("water is impassable; the bridge on the far side changes nothing without a path to it", () => {
    const tiles = [...base.tiles];
    tiles[0] = ["plain", "river", "bridge", "plain", "plain"];
    const units = [unit("P-sword-1", "player", 0, 0)];
    const preview = localPreview({
      ...base,
      tiles,
      units,
      unitId: "P-sword-1",
      staged: [],
    });
    // the river at (1,0) cuts row 0; the bridge sits beyond it, unreachable
    expect(asSet(preview.moveTiles)).toBe("0,0 0,1 0,2 1,1");
  });

  it("a staged unit's ORIGIN becomes landable (chain-following, 02) and its DESTINATION stays blocked by the ghost", () => {
    const units = [
      unit("P-sword-1", "player", 0, 0), // selected next, submitted last
      unit("P-axe-1", "player", 2, 0), // staged: (2,0) → (4,0)
    ];
    const staged: MoveSubmission[] = [
      {
        unitId: "P-axe-1",
        path: [
          [2, 0],
          [3, 0],
          [4, 0],
        ],
        action: { type: "wait" },
      },
    ];
    const preview = localPreview({
      ...base,
      mov: 4,
      units,
      unitId: "P-sword-1",
      staged,
    });
    const keys = asSet(preview.moveTiles);
    expect(keys).toContain("2,0"); // vacated origin — chain-following is legal
    expect(keys).toContain("3,0"); // empty in the settled state — landable
    expect(keys).not.toContain("4,0"); // the ghost claims its destination
  });

  it("two staged entries applied in ORDER settle both ghosts; the last origin re-vacates", () => {
    const units = [
      unit("P-sword-1", "player", 0, 0),
      unit("P-axe-1", "player", 2, 0), // staged first: (2,0) → (3,0)
      unit("P-spear-1", "player", 4, 0), // staged second: (4,0) → (3,0) → (2,0)
    ];
    const staged: MoveSubmission[] = [
      {
        unitId: "P-axe-1",
        path: [
          [2, 0],
          [3, 0],
        ],
        action: { type: "wait" },
      },
      {
        unitId: "P-spear-1",
        path: [
          [4, 0],
          [3, 0],
          [2, 0],
        ],
        action: { type: "wait" },
      },
    ];
    const preview = localPreview({
      ...base,
      mov: 4,
      units,
      unitId: "P-sword-1",
      staged,
    });
    const keys = asSet(preview.moveTiles);
    expect(keys).not.toContain("3,0"); // ghost axe
    expect(keys).not.toContain("2,0"); // ghost spear
    expect(keys).toContain("4,0"); // spear's vacated origin — sword is last
  });

  it("attack and heal sets respect the range list, and the ghost counts as the ally's settled tile", () => {
    const units = [
      unit("P-healer-1", "player", 0, 0, 8, 18),
      unit("P-sword-1", "player", 1, 0, 5, 20), // wounded, stages (1,0) → (2,0)
      unit("E-axe-1", "enemy", 0, 3, 10, 25),
    ];
    const staged: MoveSubmission[] = [
      {
        unitId: "P-sword-1",
        path: [
          [1, 0],
          [2, 0],
        ],
        action: { type: "wait" },
      },
    ];
    const preview = localPreview({
      ...base,
      range: [1, 2, 3],
      canHeal: true,
      units,
      unitId: "P-healer-1",
      staged,
    });
    expect(asSet(preview.attackTiles)).toBe("0,3");
    // the wounded sword's ghost at (2,0) is Manhattan 1 from the vacated (1,0)
    expect(asSet(preview.healTiles)).toBe("2,0");
  });

  it("heals a wounded ally adjacent to a reachable tile", () => {
    const units = [
      unit("P-healer-1", "player", 0, 0, 8, 18),
      unit("P-sword-1", "player", 1, 0, 5, 20),
    ];
    const preview = localPreview({
      ...base,
      canHeal: true,
      units,
      unitId: "P-healer-1",
      staged: [],
    });
    expect(asSet(preview.healTiles)).toBe("1,0");
  });

  it("returns an empty preview when the unit is unknown", () => {
    const preview = localPreview({
      ...base,
      units: [],
      unitId: "P-sword-1",
      staged: [],
    });
    expect(preview.moveTiles).toEqual([]);
    expect(preview.attackTiles).toEqual([]);
    expect(preview.healTiles).toEqual([]);
  });
});
