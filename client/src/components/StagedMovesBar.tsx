import type { MetaResponse, Unit } from "../types/api";
import type { StagedMove } from "../state/stagedMoves";
import { unitDisplayName } from "./display";

interface StagedMovesBarProps {
  staged: StagedMove[];
  units: Unit[];
  meta: MetaResponse;
  onUnstage: (unitId: string) => void;
}

function actionText(
  move: StagedMove,
  units: Unit[],
  meta: MetaResponse,
): string {
  if (move.action.type === "wait") {
    return "wait";
  }
  const targetId = move.action.targetId;
  const target = units.find((u) => u.id === targetId);
  const label =
    target !== undefined
      ? move.action.type === "heal"
        ? unitDisplayName(target, meta)
        : meta.classes[target.class].label
      : targetId;
  return `${move.action.type} ${label}`;
}

// Chips: "Archer #1 → (7,9) attack Mage"; click chip = unstage it (05).
export function StagedMovesBar({
  staged,
  units,
  meta,
  onUnstage,
}: StagedMovesBarProps): React.JSX.Element | null {
  if (staged.length === 0) {
    return null;
  }
  return (
    <div className="staged-bar" aria-label="Staged moves">
      {staged.map((move, index) => {
        const [x, y] = move.path[move.path.length - 1] ?? [0, 0];
        const unit = units.find((u) => u.id === move.unitId);
        return (
          <button
            type="button"
            key={move.unitId}
            className="staged-chip"
            data-testid={`staged-chip-${index + 1}`}
            onClick={() => onUnstage(move.unitId)}
          >
            {unit !== undefined ? unitDisplayName(unit, meta) : move.unitId} → (
            {x},{y}) {actionText(move, units, meta)} ✕
          </button>
        );
      })}
    </div>
  );
}
