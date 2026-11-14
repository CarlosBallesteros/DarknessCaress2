import { describe, expect, it } from "vitest";
import { computeDisplayPath } from "./pathDisplay";

describe("path-display helper", () => {
  it("computes shortest path over preview move tiles including origin", () => {
    const path = computeDisplayPath(
      [0, 0],
      [2, 0],
      [
        [1, 0],
        [2, 0],
        [0, 1],
      ],
    );
    expect(path).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it("returns single-entry path for staying in place", () => {
    expect(computeDisplayPath([3, 3], [3, 3], [[4, 3]])).toEqual([[3, 3]]);
  });

  it("returns null when destination is not in reachable tiles", () => {
    expect(
      computeDisplayPath(
        [0, 0],
        [2, 2],
        [
          [1, 0],
          [0, 1],
        ],
      ),
    ).toBeNull();
  });
});
