// serializeSnapshot is the compact state serializer (docs/04). It must be
// stable and config-driven (class ordering, glyphs) — used for state encoding
// utilities and debugging; move decisions are server-side policies.
import { describe, expect, it } from "vitest";
import { engineConfig } from "../../config/engine";
import type { Board, Tile, Unit } from "../../game/types";
import { parseSerializedState, serializeSnapshot } from "./serialize";

function plainBoard(): Board {
  const size = engineConfig.boardSize;
  return { tiles: Array.from({ length: size }, () => Array<Tile>(size).fill("plain")) };
}

function sampleBoard(): Board {
  const board = plainBoard();
  board.tiles[5][3] = "forest";
  board.tiles[7][7] = "hill";
  board.tiles[9][2] = "river";
  board.tiles[9][3] = "bridge";
  return board;
}

function sampleUnits(): Unit[] {
  return [
    { id: "E-sword-1", side: "enemy", class: "sword", x: 5, y: 1, hp: 20, maxHp: 20, acted: false },
    {
      id: "E-archer-1",
      side: "enemy",
      class: "archer",
      x: 6,
      y: 0,
      hp: 12,
      maxHp: 16,
      acted: false,
    },
    {
      id: "P-sword-1",
      side: "player",
      class: "sword",
      x: 4,
      y: 13,
      hp: 15,
      maxHp: 20,
      acted: false,
    },
    {
      id: "P-healer-1",
      side: "player",
      class: "healer",
      x: 10,
      y: 14,
      hp: 18,
      maxHp: 18,
      acted: true,
    },
  ];
}

describe("serializeSnapshot", () => {
  it("emits the board glyphs, stats, and units in the documented format", () => {
    const snap = serializeSnapshot(sampleBoard(), sampleUnits());
    expect(snap.startsWith("BOARD:\n")).toBe(true);
    expect(snap).toContain("\nSTATS:\n");
    expect(snap).toContain("\nUNITS:\n");
    expect(snap).toContain("...f"); // row 5, col 3 = forest glyph
    expect(snap).toContain("~B"); // row 9: river then bridge
    expect(snap).toContain("E-sword-1=sword 5,1 20/20");
    expect(snap).toContain("P-healer-1=healer 10,14 18/18");
  });

  it("orders units: enemy side first, then by class/config order, then by id number", () => {
    const snap = serializeSnapshot(sampleBoard(), sampleUnits());
    const unitSection = snap.split("UNITS:\n")[1];
    const ids = unitSection.split("\n").map((line) => line.split("=")[0]);
    expect(ids).toEqual(["E-sword-1", "E-archer-1", "P-sword-1", "P-healer-1"]);
  });

  it("round-trips through parseSerializedState", () => {
    const board = sampleBoard();
    const units = sampleUnits();
    const snap = serializeSnapshot(board, units);
    const parsed = parseSerializedState(snap);
    expect(parsed).toBeDefined();
    expect(parsed!.board).toEqual(board);
    // acted is not serialized; parse sets it false
    expect(parsed!.units).toEqual(units.map((u) => ({ ...u, acted: false })));
  });

  it("parseSerializedState returns undefined without a snapshot", () => {
    expect(parseSerializedState("no snapshot here")).toBeUndefined();
  });
});
