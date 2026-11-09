import type { MetaResponse, MoveAction, Unit } from "../types/api";
import type { Selection } from "../state/stagedMoves";
import { AssetImg } from "./AssetImg";
import { unitDisplayName } from "./display";

interface ActionPanelProps {
  meta: MetaResponse;
  themeId: string;
  selectedUnit: Unit | null;
  selection: Selection;
  attackTargets: Unit[]; // enemies attackable FROM the picked destination
  healTargets: Unit[]; // allies healable FROM the picked destination
  onBack: () => void;
  onStage: (action: MoveAction) => void;
}

// Contextual panel (05): selected unit's header (portrait + class label +
// hp/atk/def mini-stats from /api/meta), then the staged-move summary and
// buttons — or a prompt to click the board.
export function ActionPanel({
  meta,
  themeId,
  selectedUnit,
  selection,
  attackTargets,
  healTargets,
  onBack,
  onStage,
}: ActionPanelProps): React.JSX.Element {
  if (selectedUnit === null) {
    return (
      <aside className="action-panel card">
        <p className="panel-prompt">Select one of your units.</p>
      </aside>
    );
  }
  const classMeta = meta.classes[selectedUnit.class];
  const header = (
    <div className="panel-header">
      <AssetImg
        themeId={themeId}
        kind="portrait"
        classKey={selectedUnit.class}
        side="player"
        alt={classMeta.label}
        className="panel-portrait"
      />
      <div>
        <h3 className="display">{unitDisplayName(selectedUnit, meta)}</h3>
        <p className="panel-stats">
          HP {selectedUnit.hp}/{selectedUnit.maxHp} · Atk {classMeta.atk} · Def{" "}
          {classMeta.def}
        </p>
      </div>
    </div>
  );

  if (selection.kind === "move") {
    const [dx, dy] = selection.destination;
    return (
      <aside className="action-panel card">
        {header}
        <p className="panel-prompt">
          {unitDisplayName(selectedUnit, meta)} → ({dx},{dy})
        </p>
        <div className="panel-actions">
          {attackTargets.map((target) => (
            <button
              type="button"
              key={target.id}
              className="btn btn-danger"
              onClick={() => onStage({ type: "attack", targetId: target.id })}
            >
              Attack {meta.classes[target.class].label}
            </button>
          ))}
          {healTargets.map((target) => (
            <button
              type="button"
              key={target.id}
              className="btn btn-heal"
              onClick={() => onStage({ type: "heal", targetId: target.id })}
            >
              Heal {unitDisplayName(target, meta)}
            </button>
          ))}
          <button
            type="button"
            className="btn"
            onClick={() => onStage({ type: "wait" })}
          >
            Wait in place
          </button>
          <button type="button" className="btn" onClick={onBack}>
            Cancel staged
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="action-panel card">
      {header}
      <p className="panel-prompt">Pick a destination tile.</p>
    </aside>
  );
}
