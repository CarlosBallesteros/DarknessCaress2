import { describe, expect, it } from "vitest";
import type { MoveBundle, PreviewResponse } from "../types";
import { initialBoardUiState, stagedMovesReducer } from "./stagedMoves";

const preview: PreviewResponse = {
  moveTiles: [[1, 0]],
  attackTiles: [],
  healTiles: [],
  side: "player",
};

const moveA: MoveBundle = {
  unitId: "P-sword-1",
  path: [
    [0, 0],
    [1, 0],
  ],
  action: { type: "wait" },
};

const moveB: MoveBundle = {
  unitId: "P-axe-1",
  path: [[0, 1]],
  action: { type: "wait" },
};

describe("stagedMovesReducer", () => {
  it("supports selecting, picking destination, staging and unstage transitions", () => {
    let state = stagedMovesReducer(initialBoardUiState, {
      type: "selectOwnUnit",
      unitId: "P-sword-1",
      preview,
    });
    expect(state.mode).toBe("unitSelected");
    expect(state.selectedUnitId).toBe("P-sword-1");

    state = stagedMovesReducer(state, {
      type: "pickMoveDestination",
      destination: [1, 0],
      path: [
        [0, 0],
        [1, 0],
      ],
    });
    expect(state.mode).toBe("movePicked");
    expect(state.pickedDestination).toEqual([1, 0]);

    state = stagedMovesReducer(state, { type: "stageMove", move: moveA });
    expect(state.stagedMoves).toHaveLength(1);
    expect(state.selectedUnitId).toBeNull();

    state = stagedMovesReducer(state, {
      type: "selectOwnUnit",
      unitId: "P-axe-1",
      preview,
    });
    state = stagedMovesReducer(state, { type: "stageMove", move: moveB });
    expect(state.stagedMoves).toHaveLength(2);

    state = stagedMovesReducer(state, { type: "unstageMove", index: 0 });
    expect(state.stagedMoves).toHaveLength(1);
    expect(state.stagedMoves[0]?.unitId).toBe("P-axe-1");
  });

  it("keeps bundle on submit failure and records error index, then clears on success", () => {
    let state = stagedMovesReducer(initialBoardUiState, {
      type: "selectOwnUnit",
      unitId: "P-sword-1",
      preview,
    });
    state = stagedMovesReducer(state, { type: "stageMove", move: moveA });
    state = stagedMovesReducer(state, { type: "stageMove", move: moveB });

    state = stagedMovesReducer(state, { type: "beginSubmit" });
    expect(state.mode).toBe("playerTurnSubmitted");

    state = stagedMovesReducer(state, {
      type: "submitFailed",
      error: "move 2: bad move",
      errorMoveIndex: 1,
    });
    expect(state.mode).toBe("staged");
    expect(state.stagedMoves).toHaveLength(2);
    expect(state.errorMoveIndex).toBe(1);
    expect(state.submitError).toBe("move 2: bad move");

    state = stagedMovesReducer(state, { type: "submitSucceeded" });
    expect(state).toEqual(initialBoardUiState);
  });
});
