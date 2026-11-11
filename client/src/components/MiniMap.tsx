import type { Board } from "../types/api";

// Strip-card mini-map (05): the tile grid from the card's previewBoard —
// generic tile colors, never class-specific. (Unit side-dots are specified in
// 05 but the summary DTO carries tiles only — see the phase-6 report.)
const TILE_CLASS: Record<string, string> = {
  plain: "tile-plain",
  forest: "tile-forest",
  hill: "tile-hill",
  lake: "tile-lake",
  river: "tile-river",
  bridge: "tile-bridge",
  rock: "tile-rock",
};

export function MiniMap({ board }: { board: Board }): React.JSX.Element {
  return (
    <div
      className="minimap"
      aria-hidden
      style={{ "--map-size": board.tiles.length } as React.CSSProperties}
    >
      {board.tiles.map((row, y) =>
        row.map((tile, x) => (
          <span
            key={`${x}-${y}`}
            className={`minimap-cell ${TILE_CLASS[tile] ?? "tile-plain"}`}
          />
        )),
      )}
    </div>
  );
}
