import type { MetaResponse, Unit } from "../types/api";
import { AssetImg } from "./AssetImg";
import { hpBarClass, sortForDisplay, unitDisplayName } from "./display";

interface UnitTrayProps {
  units: Unit[]; // player units only
  meta: MetaResponse;
  themeId: string;
  selectedUnitId: string | null;
  stagedUnitIds: ReadonlySet<string>;
  onSelect: (unitId: string) => void;
}

// Horizontal list of the player's units in 00's display order: class icon, hp
// bar, acted state; SINGLE-LINE larger chips (labels never wrap); click =
// select (equivalent to clicking the sprite).
export function UnitTray({
  units,
  meta,
  themeId,
  selectedUnitId,
  stagedUnitIds,
  onSelect,
}: UnitTrayProps): React.JSX.Element {
  return (
    <div className="unit-tray" role="listbox" aria-label="Your army">
      {sortForDisplay(units).map((unit) => {
        const barClass = hpBarClass(unit.hp, unit.maxHp);
        return (
          <button
            type="button"
            key={unit.id}
            role="option"
            aria-selected={unit.id === selectedUnitId}
            className={[
              "tray-item",
              unit.acted ? "tray-acted" : "",
              stagedUnitIds.has(unit.id) ? "tray-staged" : "",
              unit.id === selectedUnitId ? "tray-selected" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            data-testid={`unit-tray-${unit.id}`}
            onClick={() => onSelect(unit.id)}
          >
            <AssetImg
              themeId={themeId}
              kind="sprite"
              classKey={unit.class}
              side="player"
              alt={meta.classes[unit.class].label}
              className="tray-icon"
            />
            <span className="tray-label">{unitDisplayName(unit, meta)}</span>
            <span className="unit-hp" aria-hidden>
              <span
                className={`unit-hp-fill ${barClass ?? "hp-green"}`}
                style={{ width: `${(unit.hp / unit.maxHp) * 100}%` }}
              />
            </span>
            {stagedUnitIds.has(unit.id) && <span className="tray-staged-tag">staged</span>}
          </button>
        );
      })}
    </div>
  );
}
