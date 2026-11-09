import { describe, expect, it } from "vitest";
import { plainBoard, unit } from "../../test-game.js";
import { serializeState } from "./serialize.js";

describe("serializeState (04: the compact AI snapshot)", () => {
  it("renders the golden snapshot: glyph rows, then UNITS lines", () => {
    const board = plainBoard(3);
    board.tiles[0] = ["plain", "forest", "hill"];
    board.tiles[1] = ["lake", "bridge", "rock"];
    board.tiles[2] = ["river", "plain", "plain"];
    const units = [
      unit("P-healer-1", "player", "healer", 2, 2, 9, { maxHp: 18 }),
      unit("E-sword-1", "enemy", "sword", 0, 0, 20),
    ];
    expect(serializeState(board, units)).toBe(
      [
        "BOARD:",
        ".fh",
        "LBr",
        "~..",
        "",
        "UNITS:",
        "E-sword-1=sword 0,0 20/20",
        "P-healer-1=healer 2,2 9/18",
      ].join("\n"),
    );
  });

  it("orders enemy army first, classes in display order, n ascending", () => {
    const board = plainBoard(2);
    const units = [
      unit("P-sword-2", "player", "sword", 1, 1, 20),
      unit("P-sword-1", "player", "sword", 0, 1, 20),
      unit("E-axe-1", "enemy", "axe", 1, 0, 25),
      unit("E-archer-1", "enemy", "archer", 0, 0, 16),
    ];
    const unitsBlock = serializeState(board, units).split("UNITS:\n")[1];
    expect(unitsBlock?.split("\n")).toEqual([
      "E-axe-1=axe 1,0 25/25",
      "E-archer-1=archer 0,0 16/16",
      "P-sword-1=sword 0,1 20/20",
      "P-sword-2=sword 1,1 20/20",
    ]);
  });

  it("reads hp from the given units — no stats are hardcoded in the serializer", () => {
    // 04 test 4's stability property: the snapshot mirrors whatever state it is
    // handed, so a config rebalance cannot desync it.
    const board = plainBoard(1);
    const units = [unit("E-mage-1", "enemy", "mage", 0, 0, 7)];
    expect(serializeState(board, units)).toBe(
      "BOARD:\n.\n\nUNITS:\nE-mage-1=mage 0,0 7/7",
    );
  });
});
