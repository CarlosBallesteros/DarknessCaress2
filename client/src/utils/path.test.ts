import { describe, expect, it } from "vitest";
import { shortestPath, filterAttackTilesFromDestination } from "./path";

describe("path-display helper", () => {
  it("computes shortest path over reachable tiles", () => {
    const start: [number, number] = [0, 0];
    const moveTiles: [number, number][] = [
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ];
    const path = shortestPath(start, [2, 1], moveTiles);
    expect(path).not.toBeNull();
    expect(path![0]).toEqual([0, 0]);
    expect(path![path!.length - 1]).toEqual([2, 1]);
    // shortest in grid steps: length 4 nodes => 3 moves
    expect(path!.length).toBe(4);
    for (let i = 1; i < path!.length; i++) {
      const d = Math.abs(path![i][0] - path![i - 1][0]) + Math.abs(path![i][1] - path![i - 1][1]);
      expect(d).toBe(1);
    }
  });

  it("returns single-tile path when staying in place", () => {
    expect(shortestPath([3, 4], [3, 4], [])).toEqual([[3, 4]]);
  });

  it("filters attack tiles by range from destination", () => {
    const dest: [number, number] = [5, 5];
    const tiles: [number, number][] = [
      [5, 6],
      [5, 7],
      [6, 6],
    ];
    expect(filterAttackTilesFromDestination(dest, tiles, [1])).toEqual([[5, 6]]);
    expect(filterAttackTilesFromDestination(dest, tiles, [2])).toEqual([
      [5, 7],
      [6, 6],
    ]);
  });
});
