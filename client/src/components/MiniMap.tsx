import type { GameSummary } from "../types";

const TILE_COLOR: Record<string, string> = {
  plain: "var(--tile-plain)",
  forest: "var(--tile-forest)",
  hill: "var(--tile-hill)",
  lake: "var(--tile-lake)",
  river: "var(--tile-river)",
  bridge: "var(--tile-bridge)",
  rock: "var(--tile-rock)",
};

export function MiniMap({ game }: { game: GameSummary }) {
  const tiles = game.previewBoard.tiles;
  const size = tiles.length || 8;
  const dotSizePct = (100 / size) * 0.8;
  return (
    <div
      className="mini-map"
      style={{
        gridTemplateColumns: `repeat(${size}, 1fr)`,
        gridTemplateRows: `repeat(${size}, 1fr)`,
      }}
      aria-label="Mini board map"
    >
      {tiles.flatMap((row, y) =>
        row.map((t, x) => (
          <div
            key={`${x}-${y}`}
            className="mini-tile"
            style={{ background: TILE_COLOR[t] ?? TILE_COLOR.plain }}
          />
        )),
      )}
      {game.previewUnits.map((u, idx) => (
        <div
          key={`${u.x}-${u.y}-${u.side}-${idx}`}
          className={`mini-dot ${u.side}`}
          style={{
            width: `${dotSizePct}%`,
            height: `${dotSizePct}%`,
            left: `${((u.x + 0.5) / size) * 100}%`,
            top: `${((u.y + 0.5) / size) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}
