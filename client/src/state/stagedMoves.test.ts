import { describe, expect, it } from "vitest";
import type { PreviewResponse } from "../types/api";
import { initialBoardUi, stagedMovesReducer } from "./stagedMoves";

const preview: PreviewResponse = {
  moveTiles: [
    [4, 4],
    [5, 4],
  ],
  attackTiles: [[6, 4]],
  healTiles: [],
};

const state = (
  selection: typeof initialBoardUi.selection,
  staged: typeof initialBoardUi.staged = [],
) => ({ selection, staged });

describe("stagedMovesReducer — the 05 interaction state machine", () => {
  it("starts idle with nothing staged", () => {
    expect(initialBoardUi).toEqual({ selection: { kind: "none" }, staged: [] });
  });

  it("idle → unitSelected on select; re-select replaces (unitSelected → unitSelected)", () => {
    const selected = stagedMovesReducer(initialBoardUi, {
      type: "select",
      unitId: "P-sword-1",
      preview,
    });
    expect(selected.selection).toEqual({
      kind: "unit",
      unitId: "P-sword-1",
      preview,
    });
    const reselected = stagedMovesReducer(selected, {
      type: "select",
      unitId: "P-axe-1",
      preview,
    });
    expect(reselected.selection).toEqual({
      kind: "unit",
      unitId: "P-axe-1",
      preview,
    });
    expect(reselected.staged).toEqual([]);
  });

  it("a staged unit cannot be selected again (each unit acts at most once per round)", () => {
    const picked = stagedMovesReducer(
      state({ kind: "unit", unitId: "P-sword-1", preview }),
      {
        type: "pickMove",
        destination: [5, 4],
        path: [
          [4, 4],
          [5, 4],
        ],
      },
    );
    const staged = stagedMovesReducer(picked, {
      type: "stage",
      action: { type: "wait" },
    });
    expect(staged.staged).toHaveLength(1);
    expect(
      stagedMovesReducer(staged, {
        type: "select",
        unitId: "P-sword-1",
        preview,
      }),
    ).toBe(staged);
  });

  it("unitSelected → idle on deselect (empty/dim click)", () => {
    const selected = stagedMovesReducer(initialBoardUi, {
      type: "select",
      unitId: "P-sword-1",
      preview,
    });
    expect(
      stagedMovesReducer(selected, { type: "deselect" }).selection,
    ).toEqual({
      kind: "none",
    });
  });

  it("unitSelected → movePicked keeps unit + preview and carries the SAME path", () => {
    const selected = stagedMovesReducer(initialBoardUi, {
      type: "select",
      unitId: "P-sword-1",
      preview,
    });
    const picked = stagedMovesReducer(selected, {
      type: "pickMove",
      destination: [5, 4],
      path: [
        [4, 4],
        [5, 4],
      ],
    });
    expect(picked.selection).toEqual({
      kind: "move",
      unitId: "P-sword-1",
      preview,
      destination: [5, 4],
      path: [
        [4, 4],
        [5, 4],
      ],
    });
  });

  it("movePicked → unitSelected on [Back]/Esc", () => {
    const picked = stagedMovesReducer(
      state({ kind: "unit", unitId: "P-sword-1", preview }),
      {
        type: "pickMove",
        destination: [5, 4],
        path: [
          [4, 4],
          [5, 4],
        ],
      },
    );
    const backed = stagedMovesReducer(picked, { type: "back" });
    expect(backed.selection).toEqual({
      kind: "unit",
      unitId: "P-sword-1",
      preview,
    });
    expect(stagedMovesReducer(backed, { type: "back" }).selection).toEqual({
      kind: "none",
    });
  });

  it("movePicked → staged: attack bundle {unitId, path, action}", () => {
    const picked = stagedMovesReducer(
      state({ kind: "unit", unitId: "P-archer-1", preview }),
      {
        type: "pickMove",
        destination: [5, 4],
        path: [
          [4, 4],
          [5, 4],
        ],
      },
    );
    const staged = stagedMovesReducer(picked, {
      type: "stage",
      action: { type: "attack", targetId: "E-axe-1" },
    });
    expect(staged.selection).toEqual({ kind: "none" });
    expect(staged.staged).toEqual([
      {
        unitId: "P-archer-1",
        path: [
          [4, 4],
          [5, 4],
        ],
        action: { type: "attack", targetId: "E-axe-1" },
      },
    ]);
  });

  it("heal and wait stage with the same shape; more units stack (staged → staged)", () => {
    const healer = stagedMovesReducer(
      state({ kind: "unit", unitId: "P-healer-1", preview }),
      { type: "pickMove", destination: [4, 4], path: [[4, 4]] },
    );
    const staged = stagedMovesReducer(healer, {
      type: "stage",
      action: { type: "heal", targetId: "P-sword-1" },
    });
    const next = stagedMovesReducer(
      stagedMovesReducer(staged, {
        type: "select",
        unitId: "P-axe-1",
        preview,
      }),
      { type: "pickMove", destination: [5, 4], path: [[5, 4]] },
    );
    const both = stagedMovesReducer(next, {
      type: "stage",
      action: { type: "wait" },
    });
    expect(both.staged).toEqual([
      {
        unitId: "P-healer-1",
        path: [[4, 4]],
        action: { type: "heal", targetId: "P-sword-1" },
      },
      { unitId: "P-axe-1", path: [[5, 4]], action: { type: "wait" } },
    ]);
  });

  it("unstage cancels ONLY that staged move", () => {
    const staged = state({ kind: "none" }, [
      {
        unitId: "P-healer-1",
        path: [[4, 4]],
        action: { type: "heal", targetId: "P-sword-1" },
      },
      { unitId: "P-axe-1", path: [[5, 4]], action: { type: "wait" } },
    ]);
    const result = stagedMovesReducer(staged, {
      type: "unstage",
      unitId: "P-healer-1",
    });
    expect(result.staged).toEqual([
      { unitId: "P-axe-1", path: [[5, 4]], action: { type: "wait" } },
    ]);
  });

  it("reset clears selection AND staged list (wholesale replacement)", () => {
    const staged = state({ kind: "unit", unitId: "P-axe-1", preview }, [
      { unitId: "P-axe-1", path: [[5, 4]], action: { type: "wait" } },
    ]);
    expect(stagedMovesReducer(staged, { type: "reset" })).toEqual(
      initialBoardUi,
    );
  });

  it("stage and pickMove are no-ops outside their phases", () => {
    expect(
      stagedMovesReducer(initialBoardUi, {
        type: "stage",
        action: { type: "wait" },
      }),
    ).toBe(initialBoardUi);
    expect(
      stagedMovesReducer(initialBoardUi, {
        type: "pickMove",
        destination: [5, 4],
        path: [[5, 4]],
      }),
    ).toBe(initialBoardUi);
  });
});
