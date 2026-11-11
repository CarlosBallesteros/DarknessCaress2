import type { Board, GameSummary } from "../types/api";

// Strip-card mini-map (05): a TRUE miniature — every tile rendered as a small
// flat square in its TOKEN COLOR (the same palette the real board uses), no
// terrain art, no sprites; on top, unit dots from `previewUnits` — generic
// gold/red round side markers, never class-specific.
const TILE_CLASS: Record<string, string> = {
  plain: "tile-plain",
  forest: "tile-forest",
  hill: "tile-hill",
  lake: "tile-lake",
  river: "tile-river",
  bridge: "tile-bridge",
  rock: "tile-rock",
};

export function MiniMap({
  board,
  previewUnits,
}: {
  board: Board;
  previewUnits: GameSummary["previewUnits"];
}): React.JSX.Element {
  return (
    <div
      className="minimap"
      aria-hidden
      style={{ "--map-size": board.tiles.length } as React.CSSProperties}
    >
      {board.tiles.map((row, y) =>
        row.map((tile, x) => (
          <span key={`${x}-${y}`} className={`minimap-cell ${TILE_CLASS[tile] ?? "tile-plain"}`} />
        )),
      )}
      {previewUnits.map((unit) => (
        <span
          key={`${unit.side}-${unit.x}-${unit.y}`}
          className={`minimap-dot dot-${unit.side}`}
          style={
            {
              "--dot-x": unit.x,
              "--dot-y": unit.y,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
