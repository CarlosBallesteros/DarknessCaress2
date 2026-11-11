import type { MetaResponse, MoveAction, Unit, XY } from "../types/api";
import type { Selection } from "../state/stagedMoves";
import { AssetImg } from "./AssetImg";
import { unitDisplayName } from "./display";

interface ActionPanelProps {
  meta: MetaResponse;
  themeId: string;
  selectedUnit: Unit | null; // either side — inspection shows enemies too
  selection: Selection;
  destination: XY | null; // movePicked destination, for the summary line
  attackTargets: Unit[]; // enemies attackable FROM the picked destination
  healTargets: Unit[]; // allies healable FROM the picked destination
  onBack: () => void;
  onStage: (action: MoveAction) => void;
}

// Contextual panel (05): header = the selected unit's PORTRAIT (player OR
// enemy side) + class label + hp/atk/def mini-stats from /api/meta, then the
// staged move summary + buttons — or a prompt to click the board. Inspection
// shows NO staging, NO buttons (05's enemy-inspect rule).
export function ActionPanel({
  meta,
  themeId,
  selectedUnit,
  selection,
  destination,
  attackTargets,
  healTargets,
  onBack,
  onStage,
}: ActionPanelProps): React.JSX.Element {
  if (selectedUnit === null) {
    return (
      <aside className="action-panel card">
        <p className="panel-prompt">Select one of your units — or click an enemy to inspect it.</p>
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
        side={selectedUnit.side}
        alt={classMeta.label}
        className="panel-portrait"
      />
      <div>
        <h3 className="display">{unitDisplayName(selectedUnit, meta)}</h3>
        <p className="panel-stats">
          HP {selectedUnit.hp}/{selectedUnit.maxHp} · Atk {classMeta.atk} · Def {classMeta.def}
        </p>
      </div>
    </div>
  );

  if (selection.kind === "inspect") {
    // pure inspection — read-only, no staging, no buttons (05)
    return (
      <aside className="action-panel card">
        {header}
        <p className="panel-prompt">Enemy unit — inspection only.</p>
      </aside>
    );
  }

  if (selection.kind === "move" && destination !== null) {
    return (
      <aside className="action-panel card">
        {header}
        <p className="panel-prompt">
          {unitDisplayName(selectedUnit, meta)} → ({destination[0]},{destination[1]})
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
          <button type="button" className="btn" onClick={() => onStage({ type: "wait" })}>
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
