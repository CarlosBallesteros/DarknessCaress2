import type { MoveAction, MoveSubmission, PreviewResponse, XY } from "../types/api";

// Staged-moves state machine (05, "Interaction state machine — exact"):
//   idle → unitSelected → movePicked → staged (+unstage via chips)
//   idle → enemyInspect (read-only; Esc/empty click → idle)
// Staged moves are CLIENT-LOCAL until [End turn] submits them as one bundle.

export type StagedMove = MoveSubmission;

export type Selection =
  | { kind: "none" }
  | { kind: "unit"; unitId: string; preview: PreviewResponse }
  | {
      kind: "move";
      unitId: string;
      preview: PreviewResponse;
      destination: XY;
      path: XY[];
    }
  // enemy inspection (05): same preview endpoint, read-only — NO staging,
  // NO buttons; the ActionPanel shows the enemy's portrait + stats.
  | { kind: "inspect"; unitId: string; preview: PreviewResponse };

export interface BoardUiState {
  selection: Selection;
  staged: StagedMove[];
  // ERROR HIGHLIGHTING (05): on POST /moves 400 "move N: …" the reducer
  // records the 1-based index; the UI flashes the Nth chip + the Nth unit's
  // sprite ring. Failed attempts do not consume the round's budget.
  errorMoveIndex: number | null;
}

export type BoardUiAction =
  // click own non-acted, not-yet-staged unit (preview fetched by the component)
  | { type: "select"; unitId: string; preview: PreviewResponse }
  // click an enemy unit with nothing selected (read-only inspection)
  | { type: "inspect"; unitId: string; preview: PreviewResponse }
  // click empty/dim area
  | { type: "deselect" }
  // [Back] / Esc: movePicked → unitSelected; unitSelected/inspect → idle
  | { type: "back" }
  // click a moveTile; path comes from the boardPath helper over the SAME
  // preview's reachable tiles and is reused verbatim when staging
  | { type: "pickMove"; destination: XY; path: XY[] }
  // click enemy in the red overlay / own wounded in the green one /
  // [Wait in place] — stages the whole bundle for the selected unit
  | { type: "stage"; action: MoveAction }
  // chip click cancels ONLY that staged move
  | { type: "unstage"; unitId: string }
  // POST /moves returned 400 "move N: …" — record the 1-based index (05)
  | { type: "submitFailed"; index: number }
  // a fresh submission attempt clears the previous error flash
  | { type: "clearError" }
  // wholesale replacement: turn applied / game replaced → start clean
  | { type: "reset" };

export const initialBoardUi: BoardUiState = {
  selection: { kind: "none" },
  staged: [],
  errorMoveIndex: null,
};

export function stagedMovesReducer(state: BoardUiState, action: BoardUiAction): BoardUiState {
  switch (action.type) {
    case "select": {
      if (state.staged.some((m) => m.unitId === action.unitId)) {
        return state; // a staged unit cannot act again this round (06 ep. 13)
      }
      return {
        ...state,
        selection: {
          kind: "unit",
          unitId: action.unitId,
          preview: action.preview,
        },
      };
    }
    case "inspect":
      return {
        ...state,
        selection: {
          kind: "inspect",
          unitId: action.unitId,
          preview: action.preview,
        },
      };
    case "deselect":
      return { ...state, selection: { kind: "none" } };
    case "back": {
      if (state.selection.kind === "move") {
        const { unitId, preview } = state.selection;
        return { ...state, selection: { kind: "unit", unitId, preview } };
      }
      return { ...state, selection: { kind: "none" } };
    }
    case "pickMove": {
      if (state.selection.kind !== "unit" && state.selection.kind !== "move") {
        return state;
      }
      const { unitId, preview } = state.selection;
      return {
        ...state,
        selection: {
          kind: "move",
          unitId,
          preview,
          destination: action.destination,
          path: action.path,
        },
      };
    }
    case "stage": {
      if (state.selection.kind !== "move") {
        return state;
      }
      const { unitId, path } = state.selection;
      return {
        selection: { kind: "none" },
        staged: [...state.staged, { unitId, path, action: action.action }],
        errorMoveIndex: state.errorMoveIndex,
      };
    }
    case "unstage":
      return {
        ...state,
        staged: state.staged.filter((m) => m.unitId !== action.unitId),
      };
    case "submitFailed":
      return { ...state, errorMoveIndex: action.index };
    case "clearError":
      return state.errorMoveIndex === null ? state : { ...state, errorMoveIndex: null };
    case "reset":
      return initialBoardUi;
  }
}
