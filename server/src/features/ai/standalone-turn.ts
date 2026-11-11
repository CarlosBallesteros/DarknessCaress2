// The standalone mock turn (docs/04): the mocked client serving a manually-run
// server (no test driver) must NOT serve the coordinate-bound committed
// fixtures — their positions match only unit-test-seeded states. It computes a
// DETERMINISTIC MINIMAL-LEGAL turn from the CURRENT game state serialized into
// the user message: enemy units sorted by id, the first one moves to the first
// adjacent free tile in reachableTiles' BFS order (path [own, target]) — or
// waits in place when fully surrounded — every other unit is omitted
// (omission is explicitly legal). Zero invented rule semantics: the engine's
// own reach.ts computes movement, there is no attack/heal/damage math here,
// and applyMoves re-validates everything against the real state.
import { engineConfig } from "../../game/engine-config";
import { distance, reachableTiles } from "../../game/reach";
import type { Board, ClassKey, Tile, Unit } from "../../game/types";
import type { ChatMessage } from "./llmClient";

// The inverse of the serializer's glyphs — single-char prompt encoding only.
const GLYPH_TILES: Record<string, Tile> = {
  ".": "plain",
  f: "forest",
  h: "hill",
  L: "lake",
  r: "rock",
  "~": "river",
  B: "bridge",
};

const CLASS_KEYS: ClassKey[] = [
  "sword",
  "axe",
  "spear",
  "archer",
  "mage",
  "healer",
];

// `id=class x,y hp/maxHp` — the serializer's unit line, verbatim.
const UNIT_LINE = /^(\S+)=(\S+) (-?\d+),(-?\d+) (\d+)\/(\d+)$/;

function parseUnitLine(line: string): Unit | undefined {
  const match = UNIT_LINE.exec(line);
  if (match === null) return undefined;
  const id = match[1] as string;
  const klass = match[2] as ClassKey;
  if (!CLASS_KEYS.includes(klass)) return undefined;
  return {
    id,
    side: id.startsWith("E-") ? "enemy" : "player",
    class: klass,
    x: Number(match[3]),
    y: Number(match[4]),
    hp: Number(match[5]),
    maxHp: Number(match[6]),
    acted: false,
  };
}

// Decodes serializeState's snapshot into an engine state. The glyphs are
// prompt encoding (docs/04: no validator reads them) — but the standalone
// mock must act on exactly the state the caller serialized.
export function parseSerializedState(
  content: string,
): { board: Board; units: Unit[] } | undefined {
  const boardAt = content.indexOf("BOARD:\n");
  const unitsAt = content.indexOf("UNITS:\n");
  if (boardAt < 0 || unitsAt < boardAt) return undefined;
  const rows = content
    .slice(boardAt + "BOARD:\n".length, unitsAt)
    .trim()
    .split("\n")
    .map((row) => row.trim());
  const size = rows[0]?.length ?? 0;
  if (
    size === 0 ||
    rows.length !== size ||
    rows.some((row) => row.length !== size)
  ) {
    return undefined;
  }
  const decoded: Array<Array<Tile | undefined>> = rows.map((row) =>
    [...row].map((glyph) => GLYPH_TILES[glyph]),
  );
  if (decoded.some((row) => row.some((tile) => tile === undefined))) {
    return undefined;
  }
  const units: Unit[] = [];
  const block = content.slice(unitsAt + "UNITS:\n".length);
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (line === "") break; // the snapshot's unit block ends at the first blank line
    const unit = parseUnitLine(line);
    if (unit === undefined) return undefined;
    units.push(unit);
  }
  return { board: { tiles: decoded as Board["tiles"] }, units };
}

// Plain lexicographic id order — deterministic, no locale surprises.
function byId(a: Unit, b: Unit): number {
  if (a.id < b.id) return -1;
  return a.id > b.id ? 1 : 0;
}

export function standaloneTurnBundle(messages: ChatMessage[]): unknown {
  const state = messages
    .map((message) => parseSerializedState(message.content))
    .find((parsed) => parsed !== undefined);
  if (state === undefined) return { moves: [] };
  const unit = [...state.units]
    .filter((candidate) => candidate.side === "enemy")
    .sort(byId)[0];
  if (unit === undefined) return { moves: [] };
  for (const key of reachableTiles(
    state.board,
    state.units,
    unit,
    engineConfig,
  )) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    if (distance(unit.x, unit.y, x, y) === 1) {
      return {
        moves: [
          {
            unitId: unit.id,
            path: [
              [unit.x, unit.y],
              [x, y],
            ],
            action: { type: "wait" },
          },
        ],
      };
    }
  }
  // Fully surrounded: an explicit wait entry — a 1-entry path at the unit's
  // own tile is legal (docs/02).
  return {
    moves: [
      {
        unitId: unit.id,
        path: [[unit.x, unit.y]],
        action: { type: "wait" },
      },
    ],
  };
}
