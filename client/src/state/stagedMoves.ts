import type {
  MoveAction,
  MoveSubmission,
  PreviewResponse,
  XY,
} from "../types/api";

// Staged-moves state machine (05, "Interaction state machine — exact"):
//   idle → unitSelected → movePicked → staged (+unstage via chips)
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
    };

export interface BoardUiState {
  selection: Selection;
  staged: StagedMove[];
}

export type BoardUiAction =
  // click own non-acted, not-yet-staged unit (preview fetched by the component)
  | { type: "select"; unitId: string; preview: PreviewResponse }
  // click empty/dim area
  | { type: "deselect" }
  // [Back] / Esc: movePicked → unitSelected; unitSelected → idle
  | { type: "back" }
  // click a moveTile; path comes from the boardPath helper over the SAME
  // preview's reachable tiles and is reused verbatim when staging
  | { type: "pickMove"; destination: XY; path: XY[] }
  // click enemy in the filtered red overlay / own wounded in the green one /
  // [Wait in place] — stages the whole bundle for the selected unit
  | { type: "stage"; action: MoveAction }
  // chip click cancels ONLY that staged move
  | { type: "unstage"; unitId: string }
  // wholesale replacement: turn applied / game replaced → start clean
  | { type: "reset" };

export const initialBoardUi: BoardUiState = {
  selection: { kind: "none" },
  staged: [],
};

export function stagedMovesReducer(
  state: BoardUiState,
  action: BoardUiAction,
): BoardUiState {
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
      if (state.selection.kind === "none") {
        return state;
      }
      const { unitId, preview } =
        state.selection.kind === "unit"
          ? state.selection
          : {
              unitId: state.selection.unitId,
              preview: state.selection.preview,
            };
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
      };
    }
    case "unstage":
      return {
        ...state,
        staged: state.staged.filter((m) => m.unitId !== action.unitId),
      };
    case "reset":
      return initialBoardUi;
  }
}
