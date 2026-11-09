import { describe, expect, it } from "vitest";
import type { XY } from "../types/api";
import { manhattan, shortestPath } from "./boardPath";

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
