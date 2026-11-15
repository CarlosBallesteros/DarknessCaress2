import type { MovePayload, PreviewResponse, Unit } from "../types";

export type Point = [number, number];

export type StagedMove = MovePayload;

export type BoardMode =
  | { kind: "idle" }
  | { kind: "unitSelected"; unitId: string; preview: PreviewResponse }
  | {
      kind: "movePicked";
      unitId: string;
      preview: PreviewResponse;
      destination: Point;
      path: Point[];
    }
  | { kind: "enemyInspect"; unitId: string; preview: PreviewResponse };

export interface BoardState {
  mode: BoardMode;
  staged: StagedMove[];
  errorMoveIndex: number | null;
  errorMessage: string | null;
  errorFlashUntil: number | null;
}

export const initialBoardState: BoardState = {
  mode: { kind: "idle" },
  staged: [],
  errorMoveIndex: null,
  errorMessage: null,
  errorFlashUntil: null,
};

export type BoardAction =
  | { type: "reset" }
  | { type: "selectUnit"; unitId: string; preview: PreviewResponse }
  | { type: "inspectEnemy"; unitId: string; preview: PreviewResponse }
  | { type: "pickDestination"; destination: Point; path: Point[] }
  | { type: "backToSelected" }
  | { type: "clearMode" }
  | { type: "stageMove"; move: StagedMove }
  | { type: "unstage"; index: number }
  | { type: "setError"; index: number | null; message: string | null; flashUntil?: number | null }
  | { type: "clearError" };

function canSelectOwn(unit: Unit | null | undefined): boolean {
  return !!unit && unit.side === "player" && !unit.acted;
}

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "reset":
      return initialBoardState;
    case "selectUnit":
      return {
        ...state,
        mode: { kind: "unitSelected", unitId: action.unitId, preview: action.preview },
      };
    case "inspectEnemy":
      return {
        ...state,
        mode: { kind: "enemyInspect", unitId: action.unitId, preview: action.preview },
      };
    case "pickDestination":
      if (state.mode.kind !== "unitSelected" && state.mode.kind !== "movePicked") return state;
      return {
        ...state,
        mode: {
          kind: "movePicked",
          unitId: state.mode.unitId,
          preview: state.mode.preview,
          destination: action.destination,
          path: action.path,
        },
      };
    case "backToSelected":
      if (state.mode.kind === "movePicked") {
        return {
          ...state,
          mode: { kind: "unitSelected", unitId: state.mode.unitId, preview: state.mode.preview },
        };
      }
      return state;
    case "clearMode":
      return { ...state, mode: { kind: "idle" } };
    case "stageMove": {
      // replace existing staged move for same unit if any
      const filtered = state.staged.filter((m) => m.unitId !== action.move.unitId);
      return {
        ...state,
        staged: [...filtered, action.move],
        mode: { kind: "idle" },
        errorMoveIndex: null,
        errorMessage: null,
      };
    }
    case "unstage": {
      const next = state.staged.filter((_, i) => i !== action.index);
      const errIdx =
        state.errorMoveIndex === null
          ? null
          : state.errorMoveIndex === action.index
            ? null
            : state.errorMoveIndex > action.index
              ? state.errorMoveIndex - 1
              : state.errorMoveIndex;
      return {
        ...state,
        staged: next,
        errorMoveIndex: errIdx,
        errorMessage: errIdx === null ? null : state.errorMessage,
      };
    }
    case "setError":
      return {
        ...state,
        errorMoveIndex: action.index,
        errorMessage: action.message,
        errorFlashUntil: action.flashUntil ?? (action.index !== null ? Date.now() + 1200 : null),
      };
    case "clearError":
      return { ...state, errorMoveIndex: null, errorMessage: null, errorFlashUntil: null };
    default:
      return state;
  }
}

export function isOwnSelectable(unit: Unit | undefined, staged: StagedMove[]): boolean {
  if (!canSelectOwn(unit)) return false;
  // units already staged this round are not selectable for another staged action in same way?
  // spec allows unstage via chip; selecting again is fine in general, but acted means submitted to server state.
  return !unit!.acted && !staged.some((s) => s.unitId === unit!.id);
}
