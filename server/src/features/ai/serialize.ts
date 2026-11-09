import type { Board, ClassKey, Unit } from "../../game/types.js";

/**
 * The AI-turn state serializer (04): compact over verbose — small models
 * degrade as payload grows. Mirrors nothing else in the system; the DTO shapes
 * are deliberately NOT matched. The single-char tile glyphs are prompt-encoding
 * only — the engine, API and DTOs always use the full tile words from 02, and
 * no validator ever reads these chars.
 */
const TILE_GLYPHS: Record<string, string> = {
  plain: ".",
  forest: "f",
  hill: "h",
  lake: "L",
  rock: "r",
  river: "~",
  bridge: "B",
};

const DISPLAY_ORDER: ClassKey[] = [
  "sword",
  "axe",
  "spear",
  "archer",
  "mage",
  "healer",
];

/** Enemy army first, classes in display order, then n — the layout of 04's example. */
function unitOrder(unit: Unit): [number, number, number] {
  const sideRank = unit.side === "enemy" ? 0 : 1;
  const classRank = DISPLAY_ORDER.indexOf(unit.class);
  const n = Number(unit.id.split("-").at(-1)) || 0;
  return [sideRank, classRank, n];
}

/** The literal serialized snapshot: BOARD rows, then UNITS lines. */
export function serializeState(board: Board, units: Unit[]): string {
  const rows = board.tiles.map((row) =>
    [...row].map((tile) => TILE_GLYPHS[tile] ?? "?").join(""),
  );
  const unitLines = [...units]
    .sort((a, b) => {
      const [sa, ca, na] = unitOrder(a);
      const [sb, cb, nb] = unitOrder(b);
      return sa - sb || ca - cb || na - nb;
    })
    .map(
      (unit) =>
        `${unit.id}=${unit.class} ${unit.x},${unit.y} ${unit.hp}/${unit.maxHp}`,
    );
  return `BOARD:\n${rows.join("\n")}\n\nUNITS:\n${unitLines.join("\n")}`;
}
