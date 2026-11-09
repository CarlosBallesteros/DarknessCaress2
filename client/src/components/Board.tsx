import type { CSSProperties } from "react";
import type { Unit, XY } from "../types/api";
import { UnitSprite } from "./UnitSprite";

export interface BoardOverlays {
  moveTiles: XY[];
  attackTiles: XY[];
  healTiles: XY[];
  pathTiles: XY[];
  selectedUnitId: string | null;
}

export interface BoardPopup {
  key: string;
  x: number;
  y: number;
  text: string;
  kind: "damage" | "heal" | "counter";
}

interface BoardProps {
  boardSize: number;
  tiles: string[][];
  units: Unit[];
  themeId: string;
  stagedUnitIds: ReadonlySet<string>;
  overlays: BoardOverlays;
  popups: BoardPopup[];
  onTileClick: (x: number, y: number) => void;
  onUnitClick: (unitId: string) => void;
}

const tileKey = (x: number, y: number): string => `${x},${y}`;

function asSet(tiles: XY[]): Set<string> {
  return new Set(tiles.map(([x, y]) => tileKey(x, y)));
}

// Board = CSS grid (boardSize × boardSize from /api/meta), tiles scale via
// min(40px, (100vw − 32px)/boardSize); units are an absolutely-positioned
// layer of transform-positioned sprites (05).
export function Board({
  boardSize,
  tiles,
  units,
  themeId,
  stagedUnitIds,
  overlays,
  popups,
  onTileClick,
  onUnitClick,
}: BoardProps): React.JSX.Element {
  const moveSet = asSet(overlays.moveTiles);
  const attackSet = asSet(overlays.attackTiles);
  const healSet = asSet(overlays.healTiles);
  const pathSet = asSet(overlays.pathTiles);
  const selected = units.find((u) => u.id === overlays.selectedUnitId);

  const tileClass = (x: number, y: number): string => {
    const k = tileKey(x, y);
    const classes = ["tile", `tile-${tiles[y]?.[x] ?? "plain"}`];
    if (selected !== undefined && selected.x === x && selected.y === y) {
      classes.push("tile-selected");
    } else if (pathSet.has(k)) {
      classes.push("tile-path");
    } else if (attackSet.has(k)) {
      classes.push("tile-attack");
    } else if (healSet.has(k)) {
      classes.push("tile-heal");
    } else if (moveSet.has(k)) {
      classes.push("tile-move");
    }
    return classes.join(" ");
  };

  return (
    <div
      className="board"
      style={{ "--board-size": boardSize } as CSSProperties}
      data-testid="board"
    >
      <div
        className="board-tiles"
        style={{
          gridTemplateColumns: `repeat(${boardSize}, var(--tile-size))`,
        }}
      >
        {tiles.map((row, y) =>
          row.map((_, x) => (
            <button
              type="button"
              key={`${x}-${y}`}
              className={tileClass(x, y)}
              data-testid={`tile-${x}-${y}`}
              aria-label={`tile ${x},${y}`}
              onClick={(e) => {
                e.stopPropagation();
                onTileClick(x, y);
              }}
            />
          )),
        )}
      </div>
      <div className="board-units" aria-hidden={false}>
        {units.map((unit) => (
          <UnitSprite
            key={unit.id}
            unit={unit}
            themeId={themeId}
            selected={unit.id === overlays.selectedUnitId}
            staged={stagedUnitIds.has(unit.id)}
            onClick={() => onUnitClick(unit.id)}
          />
        ))}
        {popups.map((popup) => (
          <span
            key={popup.key}
            className={`damage-popup popup-${popup.kind}`}
            style={{
              transform: `translate(calc(var(--tile-size) * ${popup.x}), calc(var(--tile-size) * ${popup.y}))`,
            }}
          >
            {popup.text}
          </span>
        ))}
      </div>
    </div>
  );
}
