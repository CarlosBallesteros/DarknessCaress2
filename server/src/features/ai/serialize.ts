// The AI-turn state serializer (docs/04): compact over verbose — small models
// degrade as payload grows. It mirrors nothing else in the system (deliberately
// NOT the DTO shapes). The single-char tile glyphs are prompt-serialization
// encoding only: the engine, API, and DTOs always use the full tile words, the
// serializer emits the chars, and no validator ever reads them.
//
// The snapshot is emitted between bare marker lines ("BOARD:", "STATS:",
// "UNITS:") that are distinct from the explanation lines of the user-message
// template, so the mock client's standalone mode can parse the state back out
// of the conversation (docs/04) with the inverse parser below.
import type { GameConfig } from "../../config/load";
import { config } from "../../config/load";
import { engineConfig } from "../../config/engine";
import type { Board, ClassKey, Tile, Unit } from "../../game/types";
import { statsKernel } from "./statsKernel";

const GLYPHS: Record<Tile, string> = {
  plain: ".",
  forest: "f",
  hill: "h",
  lake: "L",
  rock: "r",
  river: "~",
  bridge: "B",
};

const GLYPH_TO_TILE: Record<string, Tile> = {
  ".": "plain",
  f: "forest",
  h: "hill",
  L: "lake",
  r: "rock",
  "~": "river",
  B: "bridge",
};

// Display order per docs/04's sample: the enemy army first (the model's own
// side), classes in config-key order, ids numerically within a class.
function unitComparator(cfg: GameConfig): (a: Unit, b: Unit) => number {
  const classIndex = new Map(Object.keys(cfg.classes).map((key, i) => [key, i]));
  return (a, b) => {
    const side = (a.side === "enemy" ? 0 : 1) - (b.side === "enemy" ? 0 : 1);
    if (side !== 0) return side;
    const cls = (classIndex.get(a.class) ?? 0) - (classIndex.get(b.class) ?? 0);
    if (cls !== 0) return cls;
    const na = /(\d+)$/.exec(a.id);
    const nb = /(\d+)$/.exec(b.id);
    return (na ? Number(na[1]) : 0) - (nb ? Number(nb[1]) : 0);
  };
}

export function serializeSnapshot(board: Board, units: Unit[], cfg: GameConfig = config): string {
  const rows = board.tiles.map((row) => row.map((tile) => GLYPHS[tile]).join("")).join("\n");
  const unitLines = [...units]
    .sort(unitComparator(cfg))
    .map((unit) => `${unit.id}=${unit.class} ${unit.x},${unit.y} ${unit.hp}/${unit.maxHp}`);
  return `BOARD:\n${rows}\nSTATS:\n${statsKernel(cfg)}\nUNITS:\n${unitLines.join("\n")}`;
}

export interface SerializedState {
  board: Board;
  units: Unit[];
}

// The inverse of serializeSnapshot — used only by the mock client (docs/04:
// standalone mode derives the minimal-legal turn from the current game state;
// the real client derives the schema bounds from it). Parses the snapshot
// markers out of a user message; undefined when no snapshot is present.
// `acted` is not serialized (docs/04's UNITS line) — irrelevant to both
// consumers: the mock only produces intents, and the engine validates against
// the authoritative row state.
export function parseSerializedState(text: string): SerializedState | undefined {
  const size = engineConfig.boardSize;
  const lines = text.split("\n");
  const boardStart = lines.indexOf("BOARD:");
  if (boardStart < 0) return undefined;
  const rowPattern = new RegExp(`^[.fhLr~B]{${size}}$`);
  const tiles: Tile[][] = [];
  for (let i = boardStart + 1; i < lines.length && tiles.length < size; i++) {
    if (!rowPattern.test(lines[i])) break;
    tiles.push([...lines[i]].map((glyph) => GLYPH_TO_TILE[glyph]!));
  }
  if (tiles.length !== size) return undefined;
  const unitsStart = lines.indexOf("UNITS:", boardStart);
  if (unitsStart < 0) return undefined;
  const unitPattern = /^(\S+)=(\S+) (-?\d+),(-?\d+) (\d+)\/(\d+)$/;
  const units: Unit[] = [];
  for (let i = unitsStart + 1; i < lines.length; i++) {
    const match = unitPattern.exec(lines[i]);
    if (match === null) break;
    units.push({
      id: match[1],
      side: match[1].startsWith("P-") ? "player" : "enemy",
      class: match[2] as ClassKey,
      x: Number(match[3]),
      y: Number(match[4]),
      hp: Number(match[5]),
      maxHp: Number(match[6]),
      acted: false,
    });
  }
  return { board: { tiles }, units };
}
