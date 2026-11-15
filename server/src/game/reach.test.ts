import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import configJson from "../config/config.json" with { type: "json" };
import { projectEngineConfig } from "./config.js";
import { isPathLegal, pathTo, previewMove, reachableTiles } from "./reach.js";
import type { Board, GameEngineConfig, Tile, Unit } from "./types.js";

function makeBoard(
  size: number,
  fill: Tile = "plain",
  overrides: Record<string, Tile> = {},
): Board {
  const tiles: Tile[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => fill),
  );
  for (const [k, t] of Object.entries(overrides)) {
    const [xs, ys] = k.split(",");
    tiles[Number(ys)][Number(xs)] = t;
  }
  return { tiles };
}

function u(partial: Partial<Unit> & Pick<Unit, "id" | "side" | "class" | "x" | "y">): Unit {
  return {
    hp: 10,
    maxHp: 10,
    acted: false,
    ...partial,
  };
}

const baseCfg = projectEngineConfig(configJson as Parameters<typeof projectEngineConfig>[0]);

function cfgWith(
  overrides: Partial<GameEngineConfig["classes"]["sword"]>,
  cls: Unit["class"] = "sword",
) {
  const raw = JSON.parse(JSON.stringify(configJson)) as {
    boardSize: number;
    classes: Record<string, Record<string, unknown>>;
  };
  raw.classes[cls] = { ...(raw.classes[cls] ?? {}), ...(overrides as Record<string, unknown>) };
  return projectEngineConfig(raw as Parameters<typeof projectEngineConfig>[0]);
}

describe("reach", () => {
  it("straight movement up to Mov", () => {
    const board = makeBoard(baseCfg.boardSize);
    const mover = u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 });
    const cfg = cfgWith({ mov: 3 }, "sword");
    const reach = reachableTiles(board, [mover], mover, cfg);
    expect(reach.has("1,1")).toBe(true);
    expect(reach.has("4,1")).toBe(true);
    expect(reach.has("1,4")).toBe(true);
    expect(reach.has("5,1")).toBe(false);
  });

  it("blocked by enemy", () => {
    const board = makeBoard(baseCfg.boardSize);
    const mover = u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 });
    const enemy = u({ id: "E-sword-1", side: "enemy", class: "sword", x: 2, y: 1 });
    const cfg = cfgWith({ mov: 3 }, "sword");
    const reach = reachableTiles(board, [mover, enemy], mover, cfg);
    expect(reach.has("2,1")).toBe(false);
    expect(reach.has("3,1")).toBe(false);
  });

  it("pass-through ally", () => {
    const board = makeBoard(baseCfg.boardSize);
    const mover = u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 });
    const ally = u({ id: "P-axe-1", side: "player", class: "axe", x: 2, y: 1 });
    const cfg = cfgWith({ mov: 3 }, "sword");
    const reach = reachableTiles(board, [mover, ally], mover, cfg);
    expect(reach.has("2,1")).toBe(false);
    expect(reach.has("3,1")).toBe(true);
  });

  it("water blocked except bridge", () => {
    const board = makeBoard(baseCfg.boardSize, "plain", {
      "2,1": "lake",
      "1,2": "river",
      "3,1": "bridge",
      "4,1": "river",
    });
    const mover = u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 });
    const cfg = cfgWith({ mov: 4 }, "sword");
    const reach = reachableTiles(board, [mover], mover, cfg);
    expect(reach.has("2,1")).toBe(false);
    expect(reach.has("1,2")).toBe(false);
    expect(reach.has("3,1")).toBe(true);
    expect(reach.has("4,1")).toBe(false);
  });

  it("isPathLegal validates start, adjacency, bounds, water, enemy, occupied end, and movement", () => {
    const board = makeBoard(baseCfg.boardSize, "plain", { "2,1": "lake" });
    const mover = u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 });
    const enemy = u({ id: "E-sword-1", side: "enemy", class: "sword", x: 3, y: 1 });
    const ally = u({ id: "P-axe-1", side: "player", class: "axe", x: 1, y: 3 });
    const cfg = cfgWith({ mov: 2 }, "sword");
    expect(isPathLegal(board, [mover], mover, [[0, 0]], cfg)).toBe(
      "path must start at the unit's tile",
    );
    expect(
      isPathLegal(
        board,
        [mover],
        mover,
        [
          [1, 1],
          [3, 1],
        ],
        cfg,
      ),
    ).toBe("path step (3,1) is not adjacent to the previous step");
    expect(
      isPathLegal(
        board,
        [mover],
        mover,
        [
          [1, 1],
          [2, 1],
        ],
        cfg,
      ),
    ).toBe("path step (2,1) is water");
    expect(
      isPathLegal(
        board,
        [mover, enemy],
        mover,
        [
          [1, 1],
          [1, 0],
          [2, 0],
          [3, 0],
          [3, 1],
        ],
        cfg,
      ),
    ).toBe("path length 4 exceeds movement 2");
    const cfg3 = cfgWith({ mov: 3 }, "sword");
    const board2 = makeBoard(baseCfg.boardSize);
    expect(
      isPathLegal(
        board2,
        [mover, enemy],
        mover,
        [
          [1, 1],
          [2, 1],
          [3, 1],
        ],
        cfg3,
      ),
    ).toBe("path enters an enemy unit at (3,1)");
    expect(
      isPathLegal(
        board2,
        [mover, ally],
        mover,
        [
          [1, 1],
          [1, 2],
          [1, 3],
        ],
        cfg3,
      ),
    ).toBe("path ends on an occupied tile");
    const small = projectEngineConfig({
      boardSize: 2,
      classes: configJson.classes as unknown as Record<string, Record<string, unknown>>,
    } as Parameters<typeof projectEngineConfig>[0]);
    expect(
      isPathLegal(
        makeBoard(2),
        [u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 })],
        u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 }),
        [
          [1, 1],
          [2, 1],
        ],
        small,
      ),
    ).toBe("path step (2,1) is outside the board");
  });

  it("pathTo returns shortest legal route or null", () => {
    const board = makeBoard(baseCfg.boardSize, "plain", { "2,1": "river" });
    const mover = u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 });
    const ally = u({ id: "P-axe-1", side: "player", class: "axe", x: 3, y: 1 });
    const cfg = cfgWith({ mov: 4 }, "sword");
    expect(pathTo(board, [mover], mover, [1, 1], cfg)).toEqual([[1, 1]]);
    expect(pathTo(board, [mover], mover, [2, 1], cfg)).toBeNull();
    expect(pathTo(board, [mover, ally], mover, [3, 1], cfg)).toBeNull();
    const route = pathTo(board, [mover], mover, [3, 2], cfg);
    expect(route).not.toBeNull();
    expect(route?.[0]).toEqual([1, 1]);
    expect(route?.[route.length - 1]).toEqual([3, 2]);
  });

  it("preview matches reachable/attack on a hand-built sample board", () => {
    const board = makeBoard(baseCfg.boardSize);
    const archer = u({ id: "P-archer-1", side: "player", class: "archer", x: 2, y: 2 });
    const enemyClose = u({ id: "E-sword-1", side: "enemy", class: "sword", x: 2, y: 3 });
    const enemyRange = u({ id: "E-sword-2", side: "enemy", class: "sword", x: 2, y: 4 });
    const enemyFar = u({ id: "E-sword-3", side: "enemy", class: "sword", x: 2, y: 5 });
    const units = [archer, enemyClose, enemyRange, enemyFar];
    const preview = previewMove(board, units, archer, baseCfg);
    const reach = reachableTiles(board, units, archer, baseCfg);
    expect(new Set(preview.moveTiles.map(([x, y]) => `${x},${y}`))).toEqual(reach);
    const atk = new Set(preview.attackTiles.map(([x, y]) => `${x},${y}`));
    expect(atk.has("2,4")).toBe(true);
    expect(atk.has("2,3")).toBe(true);
    expect(atk.has("2,5")).toBe(true);

    const healer = u({ id: "P-healer-1", side: "player", class: "healer", x: 4, y: 4 });
    const wounded = u({
      id: "P-sword-1",
      side: "player",
      class: "sword",
      x: 4,
      y: 5,
      hp: 10,
      maxHp: 20,
    });
    const full = u({ id: "P-axe-1", side: "player", class: "axe", x: 5, y: 4, hp: 25, maxHp: 25 });
    const hprev = previewMove(board, [healer, wounded, full], healer, baseCfg);
    const heal = new Set(hprev.healTiles.map(([x, y]) => `${x},${y}`));
    expect(heal.has("4,5")).toBe(true);
    expect(heal.has("5,4")).toBe(false);
  });
});

describe("config projection / no hardcoded movement stats", () => {
  it("rerun with mutated config numbers in a temp file still passes", () => {
    const raw = JSON.parse(JSON.stringify(configJson)) as {
      boardSize: number;
      classes: Record<string, Record<string, unknown>>;
    };
    raw.classes.sword.mov = 1;
    raw.classes.sword.range = [1];
    const tmp = path.join(os.tmpdir(), `dc2-engine-${Date.now()}-mut.json`);
    fs.writeFileSync(tmp, JSON.stringify(raw), "utf8");
    try {
      const loaded = JSON.parse(fs.readFileSync(tmp, "utf8")) as Parameters<
        typeof projectEngineConfig
      >[0];
      const cfg = projectEngineConfig(loaded);
      const board = makeBoard(cfg.boardSize);
      const mover = u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 });
      const reach = reachableTiles(board, [mover], mover, cfg);
      expect(reach.has("2,1")).toBe(true);
      expect(reach.has("3,1")).toBe(false);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
