import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadGameEngineConfigFromFile, projectGameEngineConfig } from "../config/engine";
import type { Board, Unit } from "./types";
import { isPathLegal, pathTo, previewMove, reachableTiles } from "./reach";

function loadCfg() {
  const p = process.env.GAME_CONFIG_PATH;
  if (p) return loadGameEngineConfigFromFile(p);
  return loadGameEngineConfigFromFile(path.resolve(__dirname, "../config/config.json"));
}

function boardFromStrings(rows: string[]): Board {
  const map: Record<string, Board["tiles"][number][number]> = {
    ".": "plain",
    F: "forest",
    H: "hill",
    L: "lake",
    R: "rock",
    V: "river",
    B: "bridge",
  };
  return { tiles: rows.map((row) => [...row].map((c) => map[c] ?? "plain")) };
}

function unit(partial: Partial<Unit> & Pick<Unit, "id" | "side" | "class" | "x" | "y">): Unit {
  const cfg = loadCfg();
  const cls = cfg.classes[partial.class];
  return {
    id: partial.id,
    side: partial.side,
    class: partial.class,
    x: partial.x,
    y: partial.y,
    hp: partial.hp ?? cls.hp,
    maxHp: partial.maxHp ?? cls.hp,
    acted: partial.acted ?? false,
  };
}

describe("reach", () => {
  it("straight movement up to Mov; blocked by enemy; pass-through ally; water blocked except bridge", () => {
    const cfg = loadCfg();
    const board = boardFromStrings([
      "........",
      "........",
      "........",
      "..L.B...",
      "........",
      "........",
      "........",
      "........",
    ]);
    // swordsman mov 3 at (0,3)
    const sword = unit({ id: "p1", side: "player", class: "sword", x: 0, y: 3 });
    const enemy = unit({ id: "e1", side: "enemy", class: "sword", x: 3, y: 3 });
    const ally = unit({ id: "p2", side: "player", class: "sword", x: 1, y: 3 });

    const reach = reachableTiles(board, [sword, enemy, ally], sword, cfg);
    // cannot enter enemy at (3,3)
    expect(reach.has("3,3")).toBe(false);
    // can pass through ally at (1,3), but (2,3) is lake so it is not reachable
    expect(reach.has("2,3")).toBe(false);
    // cannot end on ally
    expect(reach.has("1,3")).toBe(false);
    // alternative route around lake
    expect(reach.has("0,2")).toBe(true);
    // can route around to upper side despite enemy blocking rightward lane
    expect(reach.has("1,2")).toBe(true);
    // bridge tile itself walkable
    const reach2 = reachableTiles(board, [sword], sword, cfg);
    expect(reach2.has("4,3")).toBe(false); // still needs to route around lake in 3 moves from (0,3): 0,3-0,2-1,2-2,2 reaches 2,2 not 4,3
    // direct bridge reach with closer unit
    const s2 = unit({ id: "p3", side: "player", class: "spear", x: 4, y: 2 });
    const reach3 = reachableTiles(board, [s2], s2, cfg);
    expect(reach3.has("4,3")).toBe(true); // bridge
    expect(reach3.has("4,4")).toBe(true);

    // Mov limit
    const spear = unit({ id: "sp", side: "player", class: "spear", x: 0, y: 0 });
    const boardEmpty = boardFromStrings(Array(8).fill("........"));
    const spearReach = reachableTiles(boardEmpty, [spear], spear, cfg);
    const spearMov = cfg.classes.spear.mov;
    expect(spearReach.has(`${Math.min(spearMov, 7)},0`)).toBe(true);
    if (spearMov < 7) {
      expect(spearReach.has(`${spearMov + 1},0`)).toBe(false);
    }

    // isPathLegal messages basics
    expect(isPathLegal(board, [sword, enemy], sword, [[0, 3]], cfg)).toBeNull();
    expect(
      isPathLegal(
        board,
        [sword],
        sword,
        [
          [1, 3],
          [2, 3],
        ],
        cfg,
      ),
    ).toBe("path must start at the unit's tile");
    const swordMov = cfg.classes.sword.mov;
    const tooLong: [number, number][] = [[0, 3]];
    let cx = 0;
    let cy = 3;
    for (let i = 0; i < swordMov + 1; i++) {
      if (cy - 1 >= 0) cy -= 1;
      else cx += 1;
      tooLong.push([cx, cy]);
    }
    expect(isPathLegal(boardEmpty, [sword], { ...sword, x: 0, y: 3 }, tooLong, cfg)).toBe(
      `path length ${swordMov + 1} exceeds movement ${swordMov}`,
    );
    expect(
      isPathLegal(
        board,
        [sword, enemy],
        sword,
        [
          [0, 3],
          [1, 3],
          [2, 3],
          [3, 3],
        ],
        cfg,
      ),
    ).toBe("path step (2,3) is water");
    expect(
      isPathLegal(
        board,
        [sword, enemy, ally],
        sword,
        [
          [0, 3],
          [1, 3],
        ],
        cfg,
      ),
    ).toBe("path ends on an occupied tile");
    // entering enemy
    const swordNear = unit({ id: "p4", side: "player", class: "sword", x: 2, y: 3 });
    const board2 = boardFromStrings(Array(8).fill("........"));
    expect(
      isPathLegal(
        board2,
        [swordNear, enemy],
        swordNear,
        [
          [2, 3],
          [3, 3],
        ],
        cfg,
      ),
    ).toBe("path enters an enemy unit at (3,3)");
  });

  it("pathTo returns deterministic shortest legal route or null and respects pass-through/standability", () => {
    const cfg = loadCfg();
    const board = boardFromStrings(Array(8).fill("........"));
    const u = unit({ id: "p1", side: "player", class: "spear", x: 0, y: 0 });
    const ally = unit({ id: "p2", side: "player", class: "sword", x: 1, y: 0 });
    const p = pathTo(board, [u, ally], u, [2, 0], cfg);
    expect(p).not.toBeNull();
    expect(p![0]).toEqual([0, 0]);
    expect(p![p!.length - 1]).toEqual([2, 0]);
    // cannot end on ally
    expect(pathTo(board, [u, ally], u, [1, 0], cfg)).toBeNull();
    // unreachable
    expect(pathTo(board, [u], u, [7, 7], cfg)).toBeNull();
  });

  it("preview matches reachable/attack on a hand-built sample board", () => {
    const cfg = loadCfg();
    const board = boardFromStrings(Array(8).fill("........"));
    const archer = unit({ id: "a1", side: "player", class: "archer", x: 3, y: 3 });
    const enemy = unit({ id: "e1", side: "enemy", class: "sword", x: 3, y: 5 }); // dist 2 from (3,3)
    const enemyNear = unit({ id: "e2", side: "enemy", class: "sword", x: 3, y: 4 }); // dist 1 from (3,3), but attackable from (3,2)
    const preview = previewMove(board, [archer, enemy, enemyNear], archer, cfg);
    expect(preview.moveTiles.some(([x, y]) => x === 3 && y === 3)).toBe(false);
    expect(preview.attackTiles).toContainEqual([3, 5]);
    expect(preview.attackTiles).toContainEqual([3, 4]); // reachable final (3,2) is at distance 2
    expect(preview.healTiles).toEqual([]);

    const healer = unit({ id: "h1", side: "player", class: "healer", x: 2, y: 2 });
    const wounded = unit({
      id: "p2",
      side: "player",
      class: "sword",
      x: 2,
      y: 3,
      hp: 10,
      maxHp: 20,
    });
    const full = unit({ id: "p3", side: "player", class: "sword", x: 3, y: 2, hp: 20, maxHp: 20 });
    const hprev = previewMove(board, [healer, wounded, full], healer, cfg);
    expect(hprev.attackTiles).toEqual([]);
    expect(hprev.healTiles).toContainEqual([2, 3]);
    expect(hprev.healTiles).not.toContainEqual([3, 2]);
  });

  it("config projection from temp file can be mutated without hardcoding stats", () => {
    const cfg = loadCfg();
    const tmp = path.join(os.tmpdir(), `dc-cfg-${Date.now()}.json`);
    const mutated = {
      boardSize: cfg.boardSize,
      classes: JSON.parse(JSON.stringify(cfg.classes)),
      personalities: { aggressive: { label: "Aggressive", temperature: 0.7 } },
      themes: [],
      lore: {},
      ai: {},
      maxActiveGames: 5,
    };
    mutated.classes.sword.mov = cfg.classes.sword.mov + 1;
    fs.writeFileSync(tmp, JSON.stringify(mutated), "utf8");
    const projected = projectGameEngineConfig(
      JSON.parse(fs.readFileSync(tmp, "utf8")) as Parameters<typeof projectGameEngineConfig>[0],
    );
    expect(projected.classes.sword.mov).toBe(cfg.classes.sword.mov + 1);
    fs.unlinkSync(tmp);
  });
});
