import type { CSSProperties } from "react";
import type { Unit, XY } from "../types/api";
import { assetPath, warnMissingAsset } from "./assets";
import { UnitSprite } from "./UnitSprite";

export interface BoardOverlays {
  moveTiles: XY[];
  attackTiles: XY[];
  healTiles: XY[];
  pathTiles: XY[];
  selectedUnitId: string | null;
  // enemy inspection (05): the inspected enemy's move area uses
  // --overlay-inspect (blue, read-only) instead of the gold move overlay.
  inspectTiles: XY[];
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
  units: Unit[]; // DISPLAY positions — staged units sit as ghosts on their destination
  themeId: string;
  stagedUnitIds: ReadonlySet<string>;
  errorUnitId: string | null; // the failed staged move's unit (red ring flash)
  vacatedTiles: XY[]; // staged origins, rendered as claimed-but-vacant markers
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
// layer of transform-positioned sprites — one layer, no re-mount on move (05).
// TERRAIN SPRITES per 07: the UNIVERSAL set under assets/terrain/, one img per
// tile over the CSS color (which stays as the missing-file fallback).
export function Board({
  boardSize,
  tiles,
  units,
  themeId,
  stagedUnitIds,
  errorUnitId,
  vacatedTiles,
  overlays,
  popups,
  onTileClick,
  onUnitClick,
}: BoardProps): React.JSX.Element {
  const moveSet = asSet(overlays.moveTiles);
  const attackSet = asSet(overlays.attackTiles);
  const healSet = asSet(overlays.healTiles);
  const pathSet = asSet(overlays.pathTiles);
  const inspectSet = asSet(overlays.inspectTiles);
  const vacatedSet = asSet(vacatedTiles);
  const selected = units.find((u) => u.id === overlays.selectedUnitId);

  const tileClass = (x: number, y: number): string => {
    const k = tileKey(x, y);
    const classes = ["tile"];
    if (selected !== undefined && selected.x === x && selected.y === y) {
      classes.push("tile-selected");
    } else if (pathSet.has(k)) {
      classes.push("tile-path");
    } else if (attackSet.has(k)) {
      classes.push("tile-attack");
    } else if (healSet.has(k)) {
      classes.push("tile-heal");
    } else if (inspectSet.has(k)) {
      classes.push("tile-inspect");
    } else if (moveSet.has(k)) {
      classes.push("tile-move");
    }
    if (vacatedSet.has(k)) {
      classes.push("tile-vacated");
    }
    return classes.join(" ");
  };

  const terrainSrc = (tile: string): string => assetPath("terrain", undefined, undefined, tile);

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
          row.map((tile, x) => (
            <button
              type="button"
              key={`${x}-${y}`}
              className={`${tileClass(x, y)} tile-${tile}`}
              data-testid={`tile-${x}-${y}`}
              aria-label={`tile ${x},${y}`}
              onClick={(e) => {
                e.stopPropagation();
                onTileClick(x, y);
              }}
            >
              <img
                className="tile-img"
                src={terrainSrc(tile)}
                alt=""
                draggable={false}
                onError={(e) => {
                  // 07: terrain fallback = the CSS tile colors underneath —
                  // hide the broken img and warn exactly once per path.
                  warnMissingAsset(terrainSrc(tile));
                  e.currentTarget.style.display = "none";
                }}
              />
            </button>
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
            errorFlash={unit.id === errorUnitId}
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
