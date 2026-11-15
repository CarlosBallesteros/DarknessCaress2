import { describe, expect, it } from "vitest";
import { boardReducer, initialBoardState } from "./stagedMoves";

const preview = {
  moveTiles: [[1, 1] as [number, number]],
  attackTiles: [],
  healTiles: [],
  side: "player" as const,
};

describe("staged-moves reducer", () => {
  it("selects unit and stages a move", () => {
    let s = boardReducer(initialBoardState, { type: "selectUnit", unitId: "P-sword-1", preview });
    expect(s.mode.kind).toBe("unitSelected");
    s = boardReducer(s, {
      type: "pickDestination",
      destination: [1, 1],
      path: [
        [0, 0],
        [1, 1],
      ],
    });
    expect(s.mode.kind).toBe("movePicked");
    s = boardReducer(s, {
      type: "stageMove",
      move: {
        unitId: "P-sword-1",
        path: [
          [0, 0],
          [1, 1],
        ],
        action: { type: "wait" },
      },
    });
    expect(s.staged).toHaveLength(1);
    expect(s.mode.kind).toBe("idle");
  });

  it("unstages by index and adjusts error index", () => {
    let s = initialBoardState;
    s = boardReducer(s, {
      type: "stageMove",
      move: { unitId: "P-sword-1", path: [[0, 0]], action: { type: "wait" } },
    });
    s = boardReducer(s, {
      type: "stageMove",
      move: { unitId: "P-axe-1", path: [[1, 0]], action: { type: "wait" } },
    });
    s = boardReducer(s, { type: "setError", index: 1, message: "move 2: bad", flashUntil: 9999 });
    expect(s.errorMoveIndex).toBe(1);
    s = boardReducer(s, { type: "unstage", index: 0 });
    expect(s.staged).toHaveLength(1);
    expect(s.staged[0].unitId).toBe("P-axe-1");
    expect(s.errorMoveIndex).toBe(0);
  });

  it("replaces staged move for same unit", () => {
    let s = initialBoardState;
    s = boardReducer(s, {
      type: "stageMove",
      move: { unitId: "P-sword-1", path: [[0, 0]], action: { type: "wait" } },
    });
    s = boardReducer(s, {
      type: "stageMove",
      move: { unitId: "P-sword-1", path: [[0, 1]], action: { type: "wait" } },
    });
    expect(s.staged).toHaveLength(1);
    expect(s.staged[0].path).toEqual([[0, 1]]);
  });
});
