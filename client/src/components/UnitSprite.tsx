import type { Unit } from "../types/api";
import { AssetImg } from "./AssetImg";
import { hpBarClass } from "./display";

interface UnitSpriteProps {
  unit: Unit;
  themeId: string;
  selected: boolean;
  staged: boolean;
  onClick: () => void;
}

// One sprite instance per unit, positioned via transform so a move never
// re-mounts the node (05). Side tint ring + 3px health bar; dimmed when acted.
export function UnitSprite({
  unit,
  themeId,
  selected,
  staged,
  onClick,
}: UnitSpriteProps): React.JSX.Element {
  const barClass = hpBarClass(unit.hp, unit.maxHp);
  const classes = [
    "unit",
    `unit-${unit.side}`,
    unit.acted ? "unit-acted" : "",
    selected ? "unit-selected" : "",
    staged ? "unit-staged" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={classes}
      style={{
        transform: `translate(calc(var(--tile-size) * ${unit.x}), calc(var(--tile-size) * ${unit.y}))`,
      }}
      data-testid={`unit-${unit.id}`}
      aria-label={`${unit.side} ${unit.class} at ${unit.x},${unit.y}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <AssetImg
        themeId={themeId}
        kind="sprite"
        classKey={unit.class}
        side={unit.side}
        alt={`${unit.side} ${unit.class}`}
        className="unit-img"
      />
      {barClass !== null && (
        <span className="unit-hp" aria-hidden>
          <span
            className={`unit-hp-fill ${barClass}`}
            style={{ width: `${(unit.hp / unit.maxHp) * 100}%` }}
          />
        </span>
      )}
      {staged && (
        <span className="unit-staged-dot" aria-hidden>
          ↺
        </span>
      )}
    </button>
  );
}
