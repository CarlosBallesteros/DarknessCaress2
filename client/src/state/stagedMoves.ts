import type { MoveBundle, PreviewResponse, Unit } from "../types";

export type BoardMode =
  | "idle"
  | "unitSelected"
  | "enemyInspect"
  | "movePicked"
  | "staged"
  | "playerTurnSubmitted";

export interface BoardUiState {
  mode: BoardMode;
  selectedUnitId: string | null;
  inspectUnitId: string | null;
  preview: PreviewResponse | null;
  pickedDestination: [number, number] | null;
  displayPath: [number, number][] | null;
  stagedMoves: MoveBundle[];
  errorMoveIndex: number | null;
  submitError: string | null;
}

export type BoardUiAction =
  | { type: "reset" }
  | { type: "selectOwnUnit"; unitId: string; preview: PreviewResponse }
  | { type: "inspectEnemy"; unitId: string; preview: PreviewResponse }
  | { type: "clearSelection" }
  | { type: "pickMoveDestination"; destination: [number, number]; path: [number, number][] }
  | { type: "cancelMovePick" }
  | { type: "stageMove"; move: MoveBundle }
  | { type: "unstageMove"; index: number }
  | { type: "beginSubmit" }
  | { type: "submitFailed"; error: string; errorMoveIndex: number | null }
  | { type: "submitSucceeded" };

export const initialBoardUiState: BoardUiState = {
  mode: "idle",
  selectedUnitId: null,
  inspectUnitId: null,
  preview: null,
  pickedDestination: null,
  displayPath: null,
  stagedMoves: [],
  errorMoveIndex: null,
  submitError: null,
};

function clearError(state: BoardUiState): BoardUiState {
  if (state.errorMoveIndex === null && state.submitError === null) return state;
  return { ...state, errorMoveIndex: null, submitError: null };
}

export function stagedMovesReducer(state: BoardUiState, action: BoardUiAction): BoardUiState {
  switch (action.type) {
    case "reset":
      return { ...initialBoardUiState };
    case "selectOwnUnit":
      return {
        ...clearError(state),
        mode: "unitSelected",
        selectedUnitId: action.unitId,
        inspectUnitId: null,
        preview: action.preview,
        pickedDestination: null,
        displayPath: null,
      };
    case "inspectEnemy":
      return {
        ...clearError(state),
        mode: "enemyInspect",
        selectedUnitId: null,
        inspectUnitId: action.unitId,
        preview: action.preview,
        pickedDestination: null,
        displayPath: null,
      };
    case "clearSelection":
      return {
        ...clearError(state),
        mode: state.stagedMoves.length > 0 ? "staged" : "idle",
        selectedUnitId: null,
        inspectUnitId: null,
        preview: null,
        pickedDestination: null,
        displayPath: null,
      };
    case "pickMoveDestination":
      if (state.mode !== "unitSelected" && state.mode !== "movePicked") return state;
      return {
        ...clearError(state),
        mode: "movePicked",
        pickedDestination: action.destination,
        displayPath: action.path,
      };
    case "cancelMovePick":
      if (state.mode !== "movePicked") return state;
      return {
        ...clearError(state),
        mode: "unitSelected",
        pickedDestination: null,
        displayPath: null,
      };
    case "stageMove":
      return {
        ...state,
        mode: "staged",
        selectedUnitId: null,
        inspectUnitId: null,
        preview: null,
        pickedDestination: null,
        displayPath: null,
        stagedMoves: [...state.stagedMoves, action.move],
        errorMoveIndex: null,
        submitError: null,
      };
    case "unstageMove": {
      const next = state.stagedMoves.filter((_, i) => i !== action.index);
      const nextError =
        state.errorMoveIndex === null
          ? null
          : state.errorMoveIndex === action.index
            ? null
            : state.errorMoveIndex > action.index
              ? state.errorMoveIndex - 1
              : state.errorMoveIndex;
      const nextMode =
        state.mode === "staged" || state.mode === "idle"
          ? next.length > 0
            ? "staged"
            : "idle"
          : state.mode;
      return {
        ...state,
        mode: nextMode,
        stagedMoves: next,
        errorMoveIndex: nextError,
        submitError: nextError === null ? null : state.submitError,
      };
    }
    case "beginSubmit":
      return {
        ...state,
        mode: "playerTurnSubmitted",
        errorMoveIndex: null,
        submitError: null,
      };
    case "submitFailed":
      return {
        ...state,
        // bundle stays intact for fixing; mode returns to staged context
        mode: "staged",
        errorMoveIndex: action.errorMoveIndex,
        submitError: action.error,
      };
    case "submitSucceeded":
      return {
        ...initialBoardUiState,
      };
    default:
      return state;
  }
}

export function isUnitStaged(state: BoardUiState, unitId: string): boolean {
  return state.stagedMoves.some((m) => m.unitId === unitId);
}

export function canSelectPlayerUnit(unit: Unit, state: BoardUiState): boolean {
  return unit.side === "player" && !unit.acted && !isUnitStaged(state, unit.id);
}
