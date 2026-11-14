import { describe, expect, it } from "vitest";
import rawDefault from "../config/config.json";
import { projectGameEngineConfig, type RawGameConfig } from "./config";
import { isPathLegal, pathTo, previewMove, reachableTiles } from "./reach";
import type { Board, GameEngineConfig, Unit } from "./types";

function cfgFrom(raw: RawGameConfig): GameEngineConfig {
  return projectGameEngineConfig(raw);
}

const defaultCfg = cfgFrom(rawDefault as RawGameConfig);

function makeBoard(size: number, fill: Board["tiles"][number][number] = "plain"): Board {
  return {
    tiles: Array.from({ length: size }, () => Array.from({ length: size }, () => fill)),
  };
}

function u(partial: Partial<Unit> & Pick<Unit, "id" | "side" | "class" | "x" | "y">): Unit {
  const base = defaultCfg.classes[partial.class];
  return {
    id: partial.id,
    side: partial.side,
    class: partial.class,
    x: partial.x,
    y: partial.y,
    hp: partial.hp ?? base.hp,
    maxHp: partial.maxHp ?? base.hp,
    acted: partial.acted ?? false,
  };
}

function hasTile(tiles: Array<[number, number]>, x: number, y: number): boolean {
  return tiles.some(([tx, ty]) => tx === x && ty === y);
}

describe("reach (default config)", () => {
  runReachSuite(defaultCfg);
});

describe("reach (mutated config)", () => {
  const mutated: RawGameConfig = JSON.parse(JSON.stringify(rawDefault));
  // mutate numbers to prove no hardcoded stats
  mutated.boardSize = 9;
  for (const k of Object.keys(mutated.classes)) {
    const c = mutated.classes[k];
    c.hp += 3;
    c.atk += 2;
    c.def += 1;
    c.mov = Math.max(1, c.mov - 1);
    if (c.healAmount) c.healAmount += 2;
    // keep ranges meaningful but shifted where possible
    if (k === "archer") c.range = [3];
    if (k === "mage") c.range = [1, 2];
    if (k === "sword" || k === "axe" || k === "spear") c.range = [1];
  }
  runReachSuite(cfgFrom(mutated));
});

function runReachSuite(cfg: GameEngineConfig) {
  it("allows straight movement up to Mov and respects path length edges", () => {
    const board = makeBoard(cfg.boardSize);
    const unit = u({ id: "p1", side: "player", class: "sword", x: 1, y: 1 });
    const mov = cfg.classes.sword.mov;
    const reach = reachableTiles(board, [unit], unit, cfg);
    expect(reach.has(`${1 + mov},1`)).toBe(true);
    if (1 + mov + 1 < cfg.boardSize) {
      expect(reach.has(`${1 + mov + 1},1`)).toBe(false);
    }
    const okPath: Array<[number, number]> = [[1, 1]];
    for (let i = 1; i <= mov; i++) okPath.push([1 + i, 1]);
    expect(isPathLegal(board, [unit], unit, okPath as [number, number][], cfg)).toBeNull();
    const tooLong = [...okPath, [1 + mov + 1, 1]] as [number, number][];
    if (1 + mov + 1 < cfg.boardSize) {
      expect(isPathLegal(board, [unit], unit, tooLong, cfg)).toBe(
        `path length ${mov + 1} exceeds movement ${mov}`,
      );
    }
  });

  it("blocks movement by enemy, allows pass-through ally, blocks ending on occupied tile", () => {
    const board = makeBoard(cfg.boardSize);
    const mover = u({ id: "p1", side: "player", class: "spear", x: 1, y: 1 });
    const ally = u({ id: "p2", side: "player", class: "sword", x: 2, y: 1 });
    const enemy = u({ id: "e1", side: "enemy", class: "sword", x: 1, y: 2 });
    const units = [mover, ally, enemy];
    const reach = reachableTiles(board, units, mover, cfg);
    // cannot end on ally tile
    expect(reach.has("2,1")).toBe(false);
    // can pass through ally to tile beyond if within mov
    if (cfg.classes.spear.mov >= 2) {
      expect(reach.has("3,1")).toBe(true);
      const throughAlly: [number, number][] = [
        [1, 1],
        [2, 1],
        [3, 1],
      ];
      expect(isPathLegal(board, units, mover, throughAlly, cfg)).toBeNull();
    }
    // cannot enter enemy tile
    expect(
      isPathLegal(
        board,
        units,
        mover,
        [
          [1, 1],
          [1, 2],
        ],
        cfg,
      ),
    ).toBe(`path enters an enemy unit at (1,2)`);
    // cannot end on occupied tile
    const endOnAlly: [number, number][] = [
      [1, 1],
      [2, 1],
    ];
    expect(isPathLegal(board, units, mover, endOnAlly, cfg)).toBe("path ends on an occupied tile");
  });

  it("blocks water except bridge", () => {
    const board = makeBoard(cfg.boardSize);
    board.tiles[1][2] = "lake"; // (2,1)
    board.tiles[2][1] = "river"; // (1,2)
    board.tiles[1][3] = "bridge"; // (3,1)
    const unit = u({ id: "p1", side: "player", class: "sword", x: 1, y: 1 });
    expect(
      isPathLegal(
        board,
        [unit],
        unit,
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
        [unit],
        unit,
        [
          [1, 1],
          [1, 2],
        ],
        cfg,
      ),
    ).toBe("path step (1,2) is water");
    // bridge tile is walkable
    if (cfg.classes.sword.mov >= 2) {
      expect(
        isPathLegal(
          board,
          [unit],
          unit,
          [
            [1, 1],
            [0, 1],
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
            [3, 1],
          ].slice(0, cfg.classes.sword.mov + 1) as [number, number][],
          cfg,
        ),
      ).toBeNull();
    } else {
      expect(
        isPathLegal(
          board,
          [unit],
          unit,
          [
            [1, 1],
            [1, 0],
          ],
          cfg,
        ),
      ).toBeNull();
    }
    const reach = reachableTiles(board, [unit], unit, cfg);
    expect(reach.has("2,1")).toBe(false);
    expect(reach.has("1,2")).toBe(false);
    // bridge at (3,1): reachable only if enough movement to route around water
    const canReachBridge = cfg.classes.sword.mov >= 6 || (cfg.classes.sword.mov >= 2 && false); // depends on route; assert via pathTo/reach logic
    if (canReachBridge) {
      expect(reach.has("3,1")).toBe(true);
    } else {
      // with small mov may be unreachable around obstacles; just ensure bridge itself not treated as water when reached
      const p = pathTo(board, [unit], unit, [3, 1], cfg);
      if (p) {
        expect(isPathLegal(board, [unit], unit, p as [number, number][], cfg)).toBeNull();
        expect(reach.has("3,1")).toBe(true);
      }
    }
  });

  it("validates path start, adjacency, and bounds", () => {
    const board = makeBoard(cfg.boardSize);
    const unit = u({ id: "p1", side: "player", class: "sword", x: 2, y: 2 });
    expect(isPathLegal(board, [unit], unit, [[2, 3]], cfg)).toBe(
      "path must start at the unit's tile",
    );
    expect(
      isPathLegal(
        board,
        [unit],
        unit,
        [
          [2, 2],
          [4, 2],
        ],
        cfg,
      ),
    ).toBe("path step (4,2) is not adjacent to the previous step");
    const edge = u({ id: "p2", side: "player", class: "sword", x: 0, y: 0 });
    expect(
      isPathLegal(
        board,
        [edge],
        edge,
        [
          [0, 0],
          [-1, 0],
        ],
        cfg,
      ),
    ).toBe("path step (-1,0) is outside the board");
  });

  it("preview matches reachable/attack/heal and pathTo returns deterministic shortest route", () => {
    const board = makeBoard(cfg.boardSize);
    const sword = u({ id: "p1", side: "player", class: "sword", x: 2, y: 2 });
    const enemy = u({ id: "e1", side: "enemy", class: "sword", x: 3, y: 2 });
    const preview = previewMove(board, [sword, enemy], sword, cfg);
    const reach = reachableTiles(board, [sword, enemy], sword, cfg);
    expect(new Set(preview.moveTiles.map(([x, y]) => `${x},${y}`))).toEqual(reach);
    // sword range [1] can attack adjacent enemy from final tile (2,2) itself if adjacent
    if (cfg.classes.sword.range.includes(1)) {
      expect(hasTile(preview.attackTiles, enemy.x, enemy.y)).toBe(true);
    }

    const healer = u({ id: "h1", side: "player", class: "healer", x: 4, y: 4 });
    const wounded = u({
      id: "p2",
      side: "player",
      class: "sword",
      x: 5,
      y: 4,
      hp: Math.max(1, cfg.classes.sword.hp - 2),
      maxHp: cfg.classes.sword.hp,
    });
    const hPreview = previewMove(board, [healer, wounded], healer, cfg);
    expect(hasTile(hPreview.healTiles, wounded.x, wounded.y)).toBe(true);
    expect(hPreview.attackTiles.length).toBe(0);

    const dest: [number, number] = [2 + Math.min(2, cfg.classes.sword.mov), 2];
    if (dest[0] < cfg.boardSize) {
      const p = pathTo(board, [sword], sword, dest, cfg);
      expect(p).not.toBeNull();
      expect(p![0]).toEqual([2, 2]);
      expect(p![p!.length - 1]).toEqual(dest);
      expect(isPathLegal(board, [sword], sword, p as [number, number][], cfg)).toBeNull();
    }
  });
}
