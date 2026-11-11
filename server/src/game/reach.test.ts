import { describe, expect, it } from "vitest";
import { isPathLegal, previewMove, reachableTiles } from "./reach";
import { e, engineConfig, makeBoard, p } from "./fixtures";

const cfg = engineConfig;

describe("reachableTiles", () => {
  it("reaches every tile within a legal path of Mov edges on an open board", () => {
    const board = makeBoard();
    const sword = p("s1", "sword", 5, 5); // mov 3
    const reach = reachableTiles(board, [sword], sword, cfg);
    expect(reach.has("5,5")).toBe(true); // own tile counts as free (wait spot)
    expect(reach.has("2,5")).toBe(true); // 3 edges west
    expect(reach.has("8,5")).toBe(true); // 3 edges east
    expect(reach.has("5,2")).toBe(true);
    expect(reach.has("5,8")).toBe(true);
    expect(reach.has("1,5")).toBe(false); // 4 edges — beyond mov
    expect(reach.has("9,5")).toBe(false);
    expect(reach.has("3,3")).toBe(false); // manhattan 4
    expect(reach.has("4,4")).toBe(true); // manhattan 2
  });

  it("blocks enemy-occupied tiles entirely; allies are passable but not landable", () => {
    const board = makeBoard();
    const sword = p("s1", "sword", 5, 5); // mov 3
    const enemy = e("e1", "sword", 6, 5);
    const reach = reachableTiles(board, [sword, enemy], sword, cfg);
    expect(reach.has("6,5")).toBe(false); // may not enter an enemy tile
    expect(reach.has("7,5")).toBe(false); // only path there passes through the enemy

    const ally = p("s2", "sword", 6, 5);
    const reachAlly = reachableTiles(board, [sword, ally], sword, cfg);
    expect(reachAlly.has("6,5")).toBe(false); // may not END on an occupied tile
    expect(reachAlly.has("7,5")).toBe(true); // pass-through ally is legal
  });

  it("treats lake and river as impassable and bridge as walkable", () => {
    const board = makeBoard([
      [6, 5, "lake"],
      [6, 4, "river"],
      [6, 6, "bridge"],
    ]);
    const sword = p("s1", "sword", 5, 5);
    const reach = reachableTiles(board, [sword], sword, cfg);
    expect(reach.has("6,5")).toBe(false); // lake
    expect(reach.has("6,4")).toBe(false); // river
    expect(reach.has("6,6")).toBe(true); // bridge crosses water
  });

  it("crosses a river only on the bridge", () => {
    const river: Array<[number, number, "river" | "bridge"]> = Array.from(
      { length: 15 },
      (_, y) => [6, y, "river" as const],
    );
    river[8] = [6, 8, "bridge"];
    const board = makeBoard(river);
    const sword = p("s1", "sword", 5, 8); // mov 3, standing next to the bridge
    const reach = reachableTiles(board, [sword], sword, cfg);
    expect(reach.has("7,8")).toBe(true); // across the bridge
    expect(reach.has("6,7")).toBe(false); // the river tile itself is impassable

    // a riverless-gap board keeps the column continuous: replace, don't remove
    const unbridged = makeBoard(
      Array.from(
        { length: 15 },
        (_, y) => [6, y, "river" as const] as [number, number, "river"],
      ),
    );
    const reachNoBridge = reachableTiles(unbridged, [sword], sword, cfg);
    expect(reachNoBridge.has("7,8")).toBe(false); // no crossing anywhere without the bridge
  });
});

describe("isPathLegal", () => {
  const board = makeBoard([[6, 5, "lake"]]);
  const sword = p("s1", "sword", 5, 5); // mov 3

  it("accepts the 1-entry wait path at the unit's own tile", () => {
    expect(isPathLegal(board, [sword], sword, [[5, 5]], cfg)).toBeNull();
  });

  it("rejects paths that do not start on the unit's tile", () => {
    expect(
      isPathLegal(
        board,
        [sword],
        sword,
        [
          [5, 6],
          [5, 5],
        ],
        cfg,
      ),
    ).toBe("path must start at the unit's tile");
    expect(isPathLegal(board, [sword], sword, [], cfg)).toBe(
      "path must start at the unit's tile",
    );
  });

  it("counts path length in EDGES and names both numbers", () => {
    // 5 entries = 4 edges > mov 3
    expect(
      isPathLegal(
        board,
        [sword],
        sword,
        [
          [5, 5],
          [5, 4],
          [5, 3],
          [5, 2],
          [5, 1],
        ],
        cfg,
      ),
    ).toBe("path length 4 exceeds movement 3");
    // 4 entries = 3 edges = mov — accepted
    expect(
      isPathLegal(
        board,
        [sword],
        sword,
        [
          [5, 5],
          [5, 4],
          [5, 3],
          [5, 2],
        ],
        cfg,
      ),
    ).toBeNull();
  });

  it("enforces the 4-neighborhood with precise messages", () => {
    expect(
      isPathLegal(
        board,
        [sword],
        sword,
        [
          [5, 5],
          [7, 5],
        ],
        cfg,
      ),
    ).toBe("path step (7,5) is not adjacent to the previous step");
    expect(
      isPathLegal(
        board,
        [sword],
        sword,
        [
          [5, 5],
          [4, 5],
          [3, 5],
          [2, 5],
        ],
        cfg,
      ),
    ).toBeNull();
  });

  it("rejects steps outside the board", () => {
    const corner = p("c", "sword", 0, 5);
    expect(
      isPathLegal(
        board,
        [corner],
        corner,
        [
          [0, 5],
          [-1, 5],
        ],
        cfg,
      ),
    ).toBe("path step (-1,5) is outside the board");
  });

  it("rejects water steps and enemy entry with their catalogue messages", () => {
    expect(
      isPathLegal(
        board,
        [sword],
        sword,
        [
          [5, 5],
          [6, 5],
        ],
        cfg,
      ),
    ).toBe("path step (6,5) is water");
    const enemyBoard = makeBoard();
    const enemy = e("e1", "sword", 6, 5);
    expect(
      isPathLegal(
        enemyBoard,
        [sword, enemy],
        sword,
        [
          [5, 5],
          [6, 5],
        ],
        cfg,
      ),
    ).toBe("path enters an enemy unit at (6,5)");
  });

  it("rejects ending on an occupied tile but allows passing through allies", () => {
    const board = makeBoard(); // no water: isolate the occupancy rule
    const sword = p("s1", "sword", 5, 5); // mov 3
    const ally = p("s2", "sword", 6, 5);
    expect(
      isPathLegal(
        board,
        [sword, ally],
        sword,
        [
          [5, 5],
          [6, 5],
        ],
        cfg,
      ),
    ).toBe("path ends on an occupied tile");
    expect(
      isPathLegal(
        board,
        [sword, ally],
        sword,
        [
          [5, 5],
          [6, 5],
          [7, 5],
        ],
        cfg,
      ),
    ).toBeNull();
  });
});

describe("previewMove", () => {
  it("moveTiles match reachableTiles and melee attack tiles come from reachable final tiles", () => {
    const board = makeBoard();
    const sword = p("s1", "sword", 5, 5);
    const enemy = e("e1", "sword", 7, 5); // sword range [1]
    const preview = previewMove(board, [sword, enemy], sword, cfg);
    expect(preview.moveTiles).toEqual(
      [...reachableTiles(board, [sword, enemy], sword, cfg)].map((k) =>
        k.split(",").map(Number),
      ),
    );
    expect(preview.attackTiles).toEqual([[7, 5]]); // adjacent from the reachable tile (6,5)
    expect(preview.healTiles).toEqual([]);
  });

  it("archer range is set membership (exactly 2), so close enemies are hit by stepping back", () => {
    const board = makeBoard();
    const archer = p("a1", "archer", 5, 5); // range [2], mov 4
    const close = e("e1", "sword", 6, 5); // distance 1 from the archer's tile
    const far = e("e2", "sword", 12, 5); // every reachable tile sits ≥ 3 away (triangle: 7 − mov 4)
    const preview = previewMove(board, [archer, close, far], archer, cfg);
    expect(preview.attackTiles).toContainEqual([6, 5]); // from (4,5), reachable at 1 edge
    expect(preview.attackTiles).not.toContainEqual([12, 5]);
  });

  it("mage range [1,2,3] reaches a distance-3 enemy without moving", () => {
    const board = makeBoard();
    const mage = p("m1", "mage", 5, 5);
    const enemy = e("e1", "sword", 8, 5); // distance 3 ∈ [1,2,3]
    const preview = previewMove(board, [mage, enemy], mage, cfg);
    expect(preview.attackTiles).toContainEqual([8, 5]);
  });

  it("healer preview lists adjacent wounded allies only", () => {
    const board = makeBoard();
    const healer = p("h1", "healer", 5, 5);
    const wounded = p("s1", "sword", 5, 6, { hp: 10 });
    const healthy = p("s2", "sword", 6, 5);
    const farWounded = p("s3", "spear", 9, 5, { hp: 3 });
    const preview = previewMove(
      board,
      [healer, wounded, healthy, farWounded],
      healer,
      cfg,
    );
    expect(preview.healTiles).toEqual([[5, 6]]);
    expect(preview.attackTiles).toEqual([]);
  });
});
