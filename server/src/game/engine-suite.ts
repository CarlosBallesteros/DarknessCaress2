import { describe, expect, it } from "vitest";
import { applyMoves, checkVictory } from "./apply.js";
import {
  isPathLegal,
  manhattan,
  previewMove,
  reachableTiles,
} from "./reach.js";
import type {
  Board,
  ClassKey,
  GameEngineConfig,
  Move,
  Side,
  Tile,
  Unit,
} from "./types.js";

type Pos = [number, number];

export function emptyBoard(size: number): Board {
  return {
    tiles: Array.from({ length: size }, () =>
      Array.from({ length: size }, () => "plain" as Tile),
    ),
  };
}

function withTiles(board: Board, tiles: Array<[number, number, Tile]>): Board {
  for (const [x, y, tile] of tiles) {
    board.tiles[y]![x] = tile;
  }
  return board;
}

export function unitOf(
  cfg: GameEngineConfig,
  classKey: ClassKey,
  side: Side,
  id: string,
  pos: Pos,
  overrides?: Partial<Pick<Unit, "hp" | "maxHp" | "acted">>,
): Unit {
  const stats = cfg.classes[classKey];
  return {
    id,
    side,
    class: classKey,
    x: pos[0],
    y: pos[1],
    hp: overrides?.hp ?? stats.hp,
    maxHp: overrides?.maxHp ?? stats.hp,
    acted: overrides?.acted ?? false,
  };
}

function moveOf(unitId: string, path: Pos[], action: Move["action"]): Move {
  return { unitId, path, action };
}

function parsePos(key: string): Pos {
  const [x, y] = key.split(",");
  return [Number(x), Number(y)] as Pos;
}

function sortedPos(list: Array<Pos | string>): string[] {
  return list
    .map((entry) => (Array.isArray(entry) ? `${entry[0]},${entry[1]}` : entry))
    .sort();
}

/**
 * Every movement/path/preview scenario of 02's test list. Every expectation is
 * derived from the given GameEngineConfig, so the SAME suite validates the
 * real config and a mutated one (02: rebalancing re-validates itself).
 */
export function registerReachSuite(tag: string, cfg: GameEngineConfig): void {
  describe(tag, () => {
    describe("reachableTiles", () => {
      it("equals the ≤mov Manhattan ball on an open board", () => {
        const board = emptyBoard(cfg.boardSize);
        const sword = unitOf(cfg, "sword", "player", "s1", [4, 4]);
        const reach = reachableTiles(board, [sword], sword, cfg);
        const expected = new Set<string>();
        expected.add("4,4"); // the unit's own tile (a 0-move/wait end)
        for (let y = 0; y < cfg.boardSize; y++) {
          for (let x = 0; x < cfg.boardSize; x++) {
            if (manhattan(4, 4, x, y) <= cfg.classes.sword.mov) {
              expected.add(`${x},${y}`);
            }
          }
        }
        expect(reach).toEqual(expected);
      });

      it("blocks entirely on enemies: never entered, never ended on", () => {
        const board = emptyBoard(cfg.boardSize);
        const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
        const axe = unitOf(cfg, "axe", "enemy", "e1", [4, 4]);
        const reach = reachableTiles(board, [sword, axe], sword, cfg);
        expect(reach.has("4,4")).toBe(false);
        expect(reach.has("3,4")).toBe(true);
        // detouring around the enemy exceeds this mover's mov in the layout
        expect(reach.has("5,4")).toBe(false);
      });

      it("passes through allies but cannot end on one", () => {
        const board = emptyBoard(cfg.boardSize);
        const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
        const ally = unitOf(cfg, "spear", "player", "s2", [3, 4]);
        const reach = reachableTiles(board, [sword, ally], sword, cfg);
        expect(reach.has("3,4")).toBe(false);
        expect(reach.has("4,4")).toBe(true);
      });

      it("treats lake/river as impassable and bridge as the one crossing", () => {
        const board = withTiles(emptyBoard(cfg.boardSize), [
          [3, 4, "bridge"],
          [3, 1, "river"],
          [3, 2, "river"],
          [3, 3, "river"],
          [3, 5, "river"],
          [3, 6, "river"],
          [3, 7, "river"],
          [3, 8, "river"],
          [2, 6, "lake"],
        ]);
        const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
        const reach = reachableTiles(board, [sword], sword, cfg);
        expect(reach.has("3,4")).toBe(true); // bridge walkable
        expect(reach.has("3,3")).toBe(false);
        expect(reach.has("3,5")).toBe(false);
        expect(reach.has("2,6")).toBe(false);
        expect(reach.has("4,5")).toBe(true); // straight through the bridge
        expect(reach.has("5,4")).toBe(true); // the bridge opens the far side
      });
    });

    describe("isPathLegal — message catalogue", () => {
      it("accepts the 1-entry wait path at the unit's own tile", () => {
        const board = emptyBoard(cfg.boardSize);
        const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
        expect(isPathLegal(board, [sword], sword, [[2, 4]], cfg)).toBeNull();
      });

      it("rejects paths that do not start at the unit's tile", () => {
        const board = emptyBoard(cfg.boardSize);
        const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
        expect(isPathLegal(board, [sword], sword, [], cfg)).toBe(
          "path must start at the unit's tile",
        );
        expect(
          isPathLegal(
            board,
            [sword],
            sword,
            [
              [3, 4],
              [4, 4],
            ],
            cfg,
          ),
        ).toBe("path must start at the unit's tile");
      });

      it("rejects non-adjacent jumps — every step is one grid edge", () => {
        const board = emptyBoard(cfg.boardSize);
        const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
        expect(
          isPathLegal(
            board,
            [sword],
            sword,
            [
              [2, 4],
              [3, 4],
              [5, 4],
            ],
            cfg,
          ),
        ).toBe("path step (5,4) is not adjacent to the previous step");
        expect(
          isPathLegal(
            board,
            [sword],
            sword,
            [
              [2, 4],
              [4, 4],
            ],
            cfg,
          ),
        ).toBe("path step (4,4) is not adjacent to the previous step");
      });

      it("rejects paths longer than mov; path length = edges = entries − 1", () => {
        const board = emptyBoard(cfg.boardSize);
        const axe = unitOf(cfg, "axe", "player", "a1", [2, 4]);
        const oneTooMany: Pos[] = [];
        for (let i = 0; i <= cfg.classes.axe.mov + 1; i++) {
          oneTooMany.push([2 + i, 4]);
        }
        expect(isPathLegal(board, [axe], axe, oneTooMany, cfg)).toBe(
          `path length ${cfg.classes.axe.mov + 1} exceeds movement ${cfg.classes.axe.mov}`,
        );
        const exactlyMov: Pos[] = [];
        for (let i = 0; i <= cfg.classes.axe.mov; i++) {
          exactlyMov.push([2 + i, 4]);
        }
        expect(isPathLegal(board, [axe], axe, exactlyMov, cfg)).toBeNull();
      });

      it("rejects steps into lake/river water, naming the step tile", () => {
        const board = withTiles(emptyBoard(cfg.boardSize), [[3, 4, "lake"]]);
        const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
        expect(
          isPathLegal(
            board,
            [sword],
            sword,
            [
              [2, 4],
              [3, 4],
            ],
            cfg,
          ),
        ).toBe("path step (3,4) is water");
      });

      it("rejects steps outside the board", () => {
        const board = emptyBoard(cfg.boardSize);
        const west = unitOf(cfg, "sword", "player", "w1", [0, 4]);
        expect(
          isPathLegal(
            board,
            [west],
            west,
            [
              [0, 4],
              [-1, 4],
            ],
            cfg,
          ),
        ).toBe("path step (-1,4) is outside the board");
        const east = unitOf(cfg, "sword", "player", "w2", [
          cfg.boardSize - 1,
          4,
        ]);
        expect(
          isPathLegal(
            board,
            [east],
            east,
            [
              [cfg.boardSize - 1, 4],
              [cfg.boardSize, 4],
            ],
            cfg,
          ),
        ).toBe(`path step (${cfg.boardSize},4) is outside the board`);
      });

      it("rejects entering an enemy unit, mid-path and at the final", () => {
        const board = emptyBoard(cfg.boardSize);
        const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
        const axe = unitOf(cfg, "axe", "enemy", "e1", [3, 4]);
        const spear = unitOf(cfg, "spear", "enemy", "e2", [1, 4]);
        expect(
          isPathLegal(
            board,
            [sword, axe],
            sword,
            [
              [2, 4],
              [3, 4],
              [4, 4],
            ],
            cfg,
          ),
        ).toBe("path enters an enemy unit at (3,4)");
        expect(
          isPathLegal(
            board,
            [sword, spear],
            sword,
            [
              [2, 4],
              [1, 4],
            ],
            cfg,
          ),
        ).toBe("path enters an enemy unit at (1,4)");
      });

      it("rejects ending on an ally, allows passing through one", () => {
        const board = emptyBoard(cfg.boardSize);
        const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
        const ally = unitOf(cfg, "spear", "player", "s2", [3, 4]);
        expect(
          isPathLegal(
            board,
            [sword, ally],
            sword,
            [
              [2, 4],
              [3, 4],
            ],
            cfg,
          ),
        ).toBe("path ends on an occupied tile");
        expect(
          isPathLegal(
            board,
            [sword, ally],
            sword,
            [
              [2, 4],
              [3, 4],
              [4, 4],
            ],
            cfg,
          ),
        ).toBeNull();
      });
    });

    describe("previewMove", () => {
      /**
       * The documented definition (02): attack tiles are enemy tiles whose
       * unit stands at a Manhattan distance PRESENT IN THE RANGE LIST from
       * some reachable final tile; heal tiles are wounded same-side units
       * adjacent to some reachable final tile.
       */
      function expectedPreview(board: Board, units: Unit[], unit: Unit) {
        const reach = reachableTiles(board, units, unit, cfg);
        const finals = [...reach].map(parsePos);
        const stat = cfg.classes[unit.class];
        const attack = units
          .filter(
            (other) =>
              other.side !== unit.side &&
              stat.range.some((d) =>
                finals.some(
                  ([fx, fy]) => manhattan(fx, fy, other.x, other.y) === d,
                ),
              ),
          )
          .map((other) => `${other.x},${other.y}`);
        const heal = units
          .filter(
            (other) =>
              other.id !== unit.id &&
              other.side === unit.side &&
              stat.healAmount !== undefined &&
              other.hp < other.maxHp &&
              finals.some(
                ([fx, fy]) => manhattan(fx, fy, other.x, other.y) === 1,
              ),
          )
          .map((other) => `${other.x},${other.y}`);
        return { move: [...reach], attack: attack.sort(), heal: heal.sort() };
      }

      it("matches reachable/attack/heal on a hand-built sample board", () => {
        const board = withTiles(emptyBoard(cfg.boardSize), [
          [3, 4, "forest"],
          [1, 6, "hill"],
          [8, 8, "rock"],
          [cfg.boardSize - 1, 0, "lake"],
        ]);
        const archer = unitOf(cfg, "archer", "player", "a1", [2, 4]);
        const sword = unitOf(cfg, "sword", "player", "s1", [1, 6], {
          hp: cfg.classes.sword.hp - 5,
        });
        const axe = unitOf(cfg, "axe", "enemy", "e1", [4, 4]);
        const spear = unitOf(cfg, "spear", "enemy", "e2", [
          cfg.boardSize - 1,
          8,
        ]);
        const units = [archer, sword, axe, spear];
        const expected = expectedPreview(board, units, archer);
        const preview = previewMove(board, units, archer, cfg);
        expect(sortedPos(preview.moveTiles)).toEqual(sortedPos(expected.move));
        expect(sortedPos(preview.attackTiles)).toEqual(expected.attack);
        expect(sortedPos(preview.healTiles)).toEqual(expected.heal);
      });

      it("range is SET membership, not ≤ max — verified against the definition", () => {
        const board = emptyBoard(cfg.boardSize);
        const archer = unitOf(cfg, "archer", "player", "a1", [4, 4]);
        const adjacent = unitOf(cfg, "sword", "enemy", "e1", [5, 4]);
        const units = [archer, adjacent];
        const preview = previewMove(board, units, archer, cfg);
        // the archer's range list never contains distance 1 — a ≤max rule
        // would accept the adjacent shot, set membership does not, and the
        // preview must mirror exactly the documented definition
        expect(cfg.classes.archer.range.includes(1)).toBe(false);
        expect(sortedPos(preview.attackTiles)).toEqual(
          expectedPreview(board, units, archer).attack,
        );
      });

      it("previews enemies attackable after moving, not only from the start tile", () => {
        const board = emptyBoard(cfg.boardSize);
        const mage = unitOf(cfg, "mage", "player", "m1", [2, 4]);
        const maxRange = Math.max(...cfg.classes.mage.range);
        const axe = unitOf(cfg, "axe", "enemy", "e1", [2 + maxRange + 1, 4]);
        const units = [mage, axe];
        const preview = previewMove(board, units, mage, cfg);
        expect(sortedPos(preview.moveTiles)).toEqual(
          sortedPos(expectedPreview(board, units, mage).move),
        );
        expect(sortedPos(preview.attackTiles)).toEqual(
          expectedPreview(board, units, mage).attack,
        );
        // the axe stands BEYOND the mage's own-tile range: only a final tile
        // close to it turns the shot legal
        expect(manhattan(2, 4, axe.x, axe.y)).toBeGreaterThan(maxRange);
      });

      it("healer previews wounded allies; other classes never heal", () => {
        const board = emptyBoard(cfg.boardSize);
        const healer = unitOf(cfg, "healer", "player", "h1", [4, 4]);
        const wounded = unitOf(cfg, "sword", "player", "s1", [5, 4], {
          hp: cfg.classes.sword.hp - 1,
        });
        const healthy = unitOf(cfg, "spear", "player", "s2", [6, 4]);
        const archerAlly = unitOf(cfg, "archer", "player", "a1", [4, 5], {
          hp: cfg.classes.archer.hp - 2,
        });
        const units = [healer, wounded, healthy, archerAlly];

        const healerPreview = previewMove(board, units, healer, cfg);
        expect(sortedPos(healerPreview.healTiles)).toEqual(
          expectedPreview(board, units, healer).heal,
        );
        expect(sortedPos(healerPreview.healTiles)).toContain("5,4");
        expect(healerPreview.attackTiles).toEqual([]);

        const swordPreview = previewMove(board, units, healthy, cfg);
        expect(swordPreview.healTiles).toEqual([]);
      });
    });
  });
}

/**
 * Every application/victory scenario of 02's test list — same config-driven
 * contract as registerReachSuite. Message strings are pinned to 02's amended
 * catalogue (docs commit 9c04ffd).
 */
export function registerApplySuite(tag: string, cfg: GameEngineConfig): void {
  describe(tag, () => {
    function stateWith(...units: Unit[]): { board: Board; units: Unit[] } {
      return { board: emptyBoard(cfg.boardSize), units };
    }

    it("applies movement + wait: teleport to path end, entry counts as acted", () => {
      const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
      const spear = unitOf(cfg, "spear", "player", "s2", [1, 1]);
      const state = stateWith(sword, spear);
      const outcome = applyMoves(
        state,
        [
          moveOf(
            "s1",
            [
              [2, 4],
              [3, 4],
              [4, 4],
            ],
            { type: "wait" },
          ),
          moveOf("s2", [[1, 1]], { type: "wait" }),
        ],
        "player",
        cfg,
      );
      expect(outcome).toStrictEqual({
        ok: true,
        result: {
          events: [
            { kind: "moved", unitId: "s1", from: [2, 4], to: [4, 4] },
            { kind: "wait", unitId: "s1" },
            { kind: "wait", unitId: "s2" },
          ],
          state: {
            board: state.board,
            units: [
              { ...sword, x: 4, y: 4, acted: true },
              { ...spear, acted: true },
            ],
          },
        },
      });
    });

    it("forest/hill/rock/bridge never alter movement or the new board's tiles", () => {
      const board = withTiles(emptyBoard(cfg.boardSize), [
        [3, 4, "forest"],
        [4, 4, "hill"],
      ]);
      const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
      const outcome = applyMoves(
        { board, units: [sword] },
        [
          moveOf(
            "s1",
            [
              [2, 4],
              [3, 4],
              [4, 4],
            ],
            { type: "wait" },
          ),
        ],
        "player",
        cfg,
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.result.state.board.tiles).toEqual(board.tiles);
        expect(outcome.result.state.board.tiles[4]![3]).toBe("forest");
        expect(outcome.result.state.board.tiles[4]![4]).toBe("hill");
      }
    });

    it("attack + counter resolve with config-derived damage both ways", () => {
      const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
      const axe = unitOf(cfg, "axe", "enemy", "e1", [3, 4]);
      const outcome = applyMoves(
        stateWith(sword, axe),
        [moveOf("s1", [[2, 4]], { type: "attack", targetId: "e1" })],
        "player",
        cfg,
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        const damage = Math.max(0, cfg.classes.sword.atk - cfg.classes.axe.def);
        const countersBack =
          cfg.classes.axe.atk > 0 && cfg.classes.axe.range.includes(1);
        expect(outcome.result.events[0]).toStrictEqual({
          kind: "attack",
          attackerId: "s1",
          targetId: "e1",
          damage,
          targetHp: cfg.classes.axe.hp - damage,
        });
        if (countersBack) {
          const counter = Math.max(
            0,
            cfg.classes.axe.atk - cfg.classes.sword.def,
          );
          expect(outcome.result.events[1]).toStrictEqual({
            kind: "counter",
            attackerId: "s1",
            targetId: "e1",
            damage: counter,
            targetHp: cfg.classes.sword.hp - counter,
          });
        } else {
          expect(outcome.result.events).toHaveLength(1);
        }
      }
    });

    it("mage distance matrix: shots within range, counter only inside the defender's range", () => {
      for (const distance of cfg.classes.mage.range) {
        const countersBack =
          cfg.classes.sword.atk > 0 &&
          cfg.classes.sword.range.includes(distance);
        const mage = unitOf(cfg, "mage", "player", "m1", [2, 4]);
        const sword = unitOf(cfg, "sword", "enemy", "e1", [2 + distance, 4]);
        const outcome = applyMoves(
          stateWith(mage, sword),
          [moveOf("m1", [[2, 4]], { type: "attack", targetId: "e1" })],
          "player",
          cfg,
        );
        expect(outcome.ok).toBe(true);
        if (outcome.ok) {
          const damage = Math.max(
            0,
            cfg.classes.mage.atk - cfg.classes.sword.def,
          );
          expect(outcome.result.events.map((e) => e.kind)).toEqual(
            countersBack ? ["attack", "counter"] : ["attack"],
          );
          expect(outcome.result.events[0]).toMatchObject({
            kind: "attack",
            attackerId: "m1",
            targetId: "e1",
            damage,
            targetHp: cfg.classes.sword.hp - damage,
          });
          if (countersBack) {
            const counter = Math.max(
              0,
              cfg.classes.sword.atk - cfg.classes.mage.def,
            );
            expect(outcome.result.events[1]).toMatchObject({
              kind: "counter",
              attackerId: "m1",
              targetId: "e1",
              damage: counter,
              targetHp: cfg.classes.mage.hp - counter,
            });
          }
        }
      }
    });

    it("archers at distance 2 trade attacks", () => {
      const distance = 2;
      if (
        !cfg.classes.archer.range.includes(distance) ||
        cfg.classes.archer.atk <= 0
      ) {
        return;
      }
      const a1 = unitOf(cfg, "archer", "player", "a1", [4, 4]);
      const a2 = unitOf(cfg, "archer", "enemy", "a2", [4 + distance, 4]);
      const outcome = applyMoves(
        stateWith(a1, a2),
        [moveOf("a1", [[4, 4]], { type: "attack", targetId: "a2" })],
        "player",
        cfg,
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        const damage = Math.max(
          0,
          cfg.classes.archer.atk - cfg.classes.archer.def,
        );
        expect(outcome.result.events.map((e) => e.kind)).toEqual([
          "attack",
          "counter",
        ]);
        expect(outcome.result.events[0]).toMatchObject({
          damage,
          targetHp: cfg.classes.archer.hp - damage,
        });
        expect(outcome.result.events[1]).toMatchObject({
          attackerId: "a1",
          targetId: "a2",
          damage,
          targetHp: cfg.classes.archer.hp - damage,
        });
      }
    });

    it("spearmen at distance 1 trade attacks (mutual counter)", () => {
      const s1 = unitOf(cfg, "spear", "player", "s1", [4, 4]);
      const s2 = unitOf(cfg, "spear", "enemy", "s2", [5, 4]);
      const outcome = applyMoves(
        stateWith(s1, s2),
        [moveOf("s1", [[4, 4]], { type: "attack", targetId: "s2" })],
        "player",
        cfg,
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        const damage = Math.max(
          0,
          cfg.classes.spear.atk - cfg.classes.spear.def,
        );
        expect(outcome.result.events.map((e) => e.kind)).toEqual([
          "attack",
          "counter",
        ]);
        expect(outcome.result.events[0]).toMatchObject({
          damage,
          targetHp: cfg.classes.spear.hp - damage,
        });
        expect(outcome.result.events[1]).toMatchObject({
          damage,
          targetHp: cfg.classes.spear.hp - damage,
        });
      }
    });

    it("damage floors at 0 (never randomized)", () => {
      const floored: GameEngineConfig = {
        ...cfg,
        classes: {
          ...cfg.classes,
          sword: {
            ...cfg.classes.sword,
            atk: Math.max(1, Math.floor(cfg.classes.sword.def / 5)),
          },
        },
      };
      const sword = unitOf(floored, "sword", "player", "s1", [2, 4]);
      const axe = unitOf(floored, "axe", "enemy", "e1", [3, 4]);
      expect(floored.classes.sword.atk).toBeLessThan(floored.classes.sword.def);
      const outcome = applyMoves(
        stateWith(sword, axe),
        [moveOf("s1", [[2, 4]], { type: "attack", targetId: "e1" })],
        "player",
        floored,
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.result.events[0]).toMatchObject({
          kind: "attack",
          damage: 0,
          targetHp: cfg.classes.axe.hp,
        });
      }
      expect(
        outcome.ok ? outcome.result.events.map((e) => e.kind) : [],
      ).not.toContain("died");
    });

    it("a target reduced to hp ≤ 0 dies and is removed from the state", () => {
      const damage = Math.max(0, cfg.classes.spear.atk - cfg.classes.axe.def);
      const spear = unitOf(cfg, "spear", "player", "s1", [1, 4]);
      const axe = unitOf(cfg, "axe", "enemy", "e1", [4, 4], { hp: damage });
      const outcome = applyMoves(
        stateWith(spear, axe),
        [
          moveOf(
            "s1",
            [
              [1, 4],
              [2, 4],
              [3, 4],
            ],
            { type: "attack", targetId: "e1" },
          ),
        ],
        "player",
        cfg,
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.result.events.map((e) => e.kind)).toEqual([
          "moved",
          "attack",
          "died",
        ]);
        expect(outcome.result.state.units.some((u) => u.id === "e1")).toBe(
          false,
        );
        const survivor = outcome.result.state.units.find((u) => u.id === "s1");
        expect(survivor?.acted).toBe(true);
        expect(survivor?.x).toBe(3);
      }
    });

    it("a counter can kill: a dying attacker never resolves anything after its entry", () => {
      const counterDamage = Math.max(
        0,
        cfg.classes.axe.atk - cfg.classes.sword.def,
      );
      const sword = unitOf(cfg, "sword", "player", "s1", [2, 4], {
        hp: counterDamage,
      });
      const axe = unitOf(cfg, "axe", "enemy", "e1", [3, 4]);
      const outcome = applyMoves(
        stateWith(sword, axe),
        [moveOf("s1", [[2, 4]], { type: "attack", targetId: "e1" })],
        "player",
        cfg,
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.result.events.map((e) => e.kind)).toEqual([
          "attack",
          "counter",
          "died",
        ]);
        expect(outcome.result.events[1]).toMatchObject({
          kind: "counter",
          attackerId: "s1",
          targetId: "e1",
          damage: counterDamage,
          targetHp: 0,
        });
        // the ATTACK died to the counter; the axe survived and stays
        expect(outcome.result.state.units.some((u) => u.id === "s1")).toBe(
          false,
        );
        expect(outcome.result.state.units.some((u) => u.id === "e1")).toBe(
          true,
        );
      }
    });

    it("the healer never counters and cannot attack at all", () => {
      const healer = unitOf(cfg, "healer", "player", "h1", [4, 4]);
      const axe = unitOf(cfg, "axe", "enemy", "e1", [5, 4]);
      const attack = applyMoves(
        stateWith(healer, axe),
        [moveOf("h1", [[4, 4]], { type: "attack", targetId: "e1" })],
        "player",
        cfg,
      );
      expect(attack).toMatchObject({
        ok: false,
        error: "healer cannot attack",
      });

      // sword attacking the healer: no counter event whatsoever
      const sword = unitOf(cfg, "sword", "enemy", "s1", [3, 4]);
      const outcome = applyMoves(
        stateWith(healer, sword),
        [moveOf("s1", [[3, 4]], { type: "attack", targetId: "h1" })],
        "enemy",
        cfg,
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.result.events.map((e) => e.kind)).toEqual(["attack"]);
        expect(outcome.result.state.units.some((u) => u.id === "h1")).toBe(
          true,
        );
      }
    });

    it("heal clamps: never beyond healAmount, never beyond maxHp", () => {
      const healAmount = cfg.classes.healer.healAmount as number;
      const healer = unitOf(cfg, "healer", "player", "h1", [4, 4]);
      const deep = unitOf(cfg, "sword", "player", "s1", [5, 4], { hp: 1 });
      const deepHealed = Math.min(healAmount, deep.maxHp - 1);
      const outcome = applyMoves(
        stateWith(healer, deep),
        [moveOf("h1", [[4, 4]], { type: "heal", targetId: "s1" })],
        "player",
        cfg,
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        expect(outcome.result.events).toStrictEqual([
          {
            kind: "heal",
            healerId: "h1",
            targetId: "s1",
            healed: deepHealed,
            targetHp: 1 + deepHealed,
          },
        ]);
      }

      const missing = Math.max(1, Math.floor(healAmount / 3));
      const shallow = unitOf(cfg, "sword", "player", "s1", [5, 4], {
        hp: cfg.classes.sword.hp - missing,
      });
      const outcome2 = applyMoves(
        stateWith(healer, shallow),
        [moveOf("h1", [[4, 4]], { type: "heal", targetId: "s1" })],
        "player",
        cfg,
      );
      expect(outcome2.ok).toBe(true);
      if (outcome2.ok) {
        expect(outcome2.result.events).toStrictEqual([
          {
            kind: "heal",
            healerId: "h1",
            targetId: "s1",
            healed: missing,
            targetHp: cfg.classes.sword.hp,
          },
        ]);
      }
    });

    it("heal target must be adjacent and wounded (single catalogue message)", () => {
      const healer = unitOf(cfg, "healer", "player", "h1", [4, 4]);
      const distant = unitOf(cfg, "sword", "player", "s1", [6, 4], {
        hp: cfg.classes.sword.hp - 1,
      });
      const healthy = unitOf(cfg, "spear", "player", "s2", [5, 4]);
      const axe = unitOf(cfg, "axe", "enemy", "e1", [5, 5]);
      for (const target of [distant, healthy, axe]) {
        const outcome = applyMoves(
          stateWith(healer, distant, healthy, axe),
          [moveOf("h1", [[4, 4]], { type: "heal", targetId: target.id })],
          "player",
          cfg,
        );
        expect(outcome).toMatchObject({
          ok: false,
          error: "heal target must be adjacent and wounded",
        });
      }
    });

    it("missing targetId rejects for both actions", () => {
      const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
      const healer = unitOf(cfg, "healer", "player", "h1", [8, 4]);
      const state = stateWith(sword, healer);
      expect(
        applyMoves(
          state,
          [moveOf("s1", [[2, 4]], { type: "attack", targetId: "" })],
          "player",
          cfg,
        ),
      ).toMatchObject({ ok: false, error: "attack requires a target" });
      expect(
        applyMoves(
          state,
          [moveOf("h1", [[8, 4]], { type: "heal", targetId: "" })],
          "player",
          cfg,
        ),
      ).toMatchObject({ ok: false, error: "heal requires a target" });
    });

    it("catalogue rejections: unknown, other army, already acted, duplicate", () => {
      const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
      const axe = unitOf(cfg, "axe", "enemy", "e1", [1, 1]);
      const state = stateWith(sword, axe);
      expect(
        applyMoves(
          state,
          [moveOf("ghost", [[2, 4]], { type: "wait" })],
          "player",
          cfg,
        ),
      ).toMatchObject({ ok: false, error: "unknown unit ghost" });
      expect(
        applyMoves(
          state,
          [moveOf("e1", [[1, 1]], { type: "wait" })],
          "player",
          cfg,
        ),
      ).toMatchObject({ ok: false, error: "e1 belongs to the other army" });
      const acted = unitOf(cfg, "sword", "player", "s3", [4, 4], {
        acted: true,
      });
      expect(
        applyMoves(
          stateWith(acted),
          [moveOf("s3", [[4, 4]], { type: "wait" })],
          "player",
          cfg,
        ),
      ).toMatchObject({ ok: false, error: "s3 already acted this turn" });
      expect(
        applyMoves(
          state,
          [
            moveOf("s1", [[2, 4]], { type: "wait" }),
            moveOf("s1", [[2, 4]], { type: "wait" }),
          ],
          "player",
          cfg,
        ),
      ).toMatchObject({ ok: false, error: "s1 appears twice" });
    });

    it("attack catalogue rejections: unknown target, own side, out of range", () => {
      const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
      const ally = unitOf(cfg, "spear", "player", "s2", [3, 4]);
      const axe = unitOf(cfg, "axe", "enemy", "e1", [5, 4]);
      const state = stateWith(sword, ally, axe);
      expect(
        applyMoves(
          state,
          [moveOf("s1", [[2, 4]], { type: "attack", targetId: "ghost" })],
          "player",
          cfg,
        ),
      ).toMatchObject({ ok: false, error: "unknown unit ghost" });
      expect(
        applyMoves(
          state,
          [moveOf("s1", [[2, 4]], { type: "attack", targetId: "s2" })],
          "player",
          cfg,
        ),
      ).toMatchObject({ ok: false, error: "s2 is not a valid attack target" });
      // the first distance outside the sword's range list, on any config
      const outOfRangeDistance = [1, 2, 3, 4].find(
        (d) => !cfg.classes.sword.range.includes(d),
      ) as number;
      const distantAxe = unitOf(cfg, "axe", "enemy", "e2", [
        2 + outOfRangeDistance,
        4,
      ]);
      expect(
        applyMoves(
          stateWith(sword, distantAxe),
          [moveOf("s1", [[2, 4]], { type: "attack", targetId: "e2" })],
          "player",
          cfg,
        ),
      ).toMatchObject({
        ok: false,
        error: `sword cannot attack a unit at ${outOfRangeDistance} tiles`,
      });
    });

    it("range is set membership: an archer may never shoot an adjacent unit", () => {
      const archer = unitOf(cfg, "archer", "player", "a1", [4, 4]);
      const sword = unitOf(cfg, "sword", "enemy", "e1", [5, 4]);
      expect(cfg.classes.archer.range.includes(1)).toBe(false);
      const outcome = applyMoves(
        stateWith(archer, sword),
        [moveOf("a1", [[4, 4]], { type: "attack", targetId: "e1" })],
        "player",
        cfg,
      );
      expect(outcome).toMatchObject({
        ok: false,
        error: "archer cannot attack a unit at 1 tiles",
      });
    });

    it("landing-tile rule: two entries may not claim the same tile", () => {
      const s1 = unitOf(cfg, "sword", "player", "s1", [2, 4]);
      const s2 = unitOf(cfg, "sword", "player", "s2", [2, 6]);
      const outcome = applyMoves(
        stateWith(s1, s2),
        [
          moveOf(
            "s1",
            [
              [2, 4],
              [3, 4],
              [4, 4],
            ],
            { type: "wait" },
          ),
          moveOf(
            "s2",
            [
              [2, 6],
              [3, 6],
              [4, 6],
              [4, 5],
              [4, 4],
            ],
            { type: "wait" },
          ),
        ],
        "player",
        cfg,
      );
      expect(outcome).toMatchObject({
        ok: false,
        error: "tile (4,4) is claimed by two moves",
      });
    });

    it("landing-tile rule: no landing on a tile vacated EARLIER in the bundle", () => {
      const vacater = unitOf(cfg, "sword", "player", "sv", [4, 4]);
      const lander = unitOf(cfg, "spear", "player", "sl", [1, 4]);
      const outcome = applyMoves(
        stateWith(vacater, lander),
        [
          moveOf(
            "sv",
            [
              [4, 4],
              [5, 4],
            ],
            { type: "wait" },
          ),
          moveOf(
            "sl",
            [
              [1, 4],
              [2, 4],
              [4, 4],
            ],
            { type: "wait" },
          ),
        ],
        "player",
        cfg,
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.error).toBe(
          "tile (4,4) frees EARLIER in this bundle and cannot be landed on",
        );
      }
    });

    it("wait entries claim nothing: units may finalize next to others' landings", () => {
      const s1 = unitOf(cfg, "sword", "player", "s1", [2, 4]);
      const s2 = unitOf(cfg, "sword", "player", "s2", [5, 4]);
      const outcome = applyMoves(
        stateWith(s1, s2),
        [
          moveOf("s1", [[2, 4]], { type: "wait" }),
          moveOf(
            "s2",
            [
              [5, 4],
              [4, 4],
              [3, 4],
            ],
            { type: "wait" },
          ),
        ],
        "player",
        cfg,
      );
      expect(outcome.ok).toBe(true);
    });

    it("whole-bundle atomicity: one bad move rejects the untouched state", () => {
      const board = withTiles(emptyBoard(cfg.boardSize), [[3, 4, "lake"]]);
      const s1 = unitOf(cfg, "sword", "player", "s1", [2, 4]);
      const s2 = unitOf(cfg, "sword", "player", "s2", [6, 4]);
      const axe = unitOf(cfg, "axe", "enemy", "e1", [1, 1]);
      const state = { board, units: [s1, s2, axe] };
      const before = structuredClone(state);
      const outcome = applyMoves(
        state,
        [
          moveOf(
            "s1",
            [
              [2, 4],
              [2, 5],
              [3, 5],
              [4, 5],
            ],
            { type: "wait" },
          ),
          moveOf(
            "s2",
            [
              [6, 4],
              [5, 4],
              [4, 4],
              [3, 4],
            ],
            { type: "wait" },
          ),
        ],
        "player",
        cfg,
      );
      expect(outcome).toMatchObject({
        ok: false,
        error: "path step (3,4) is water",
      });
      expect(state).toEqual(before);
    });

    it("atomicity extends to runtime: an overkill second entry fails untouched", () => {
      const damage = Math.max(0, cfg.classes.axe.atk - cfg.classes.axe.def);
      const a1 = unitOf(cfg, "axe", "player", "a1", [2, 4]);
      const a2 = unitOf(cfg, "axe", "player", "a2", [2, 6]);
      const e1 = unitOf(cfg, "axe", "enemy", "e1", [3, 4], { hp: damage });
      const state = stateWith(a1, a2, e1);
      const before = structuredClone(state);
      const outcome = applyMoves(
        state,
        [
          moveOf("a1", [[2, 4]], { type: "attack", targetId: "e1" }),
          moveOf(
            "a2",
            [
              [2, 6],
              [3, 6],
              [3, 5],
            ],
            { type: "attack", targetId: "e1" },
          ),
        ],
        "player",
        cfg,
      );
      // e1 dies to a1's hit; a2's entry then finds only a corpse — the whole
      // bundle rejects and no partial application happens ("must still be alive")
      expect(outcome).toMatchObject({
        ok: false,
        error: "e1 is not a valid attack target",
      });
      expect(state).toEqual(before);
    });

    it("strict sequencing: a heal is judged against post-move positions", () => {
      const healer = unitOf(cfg, "healer", "player", "h1", [2, 4]);
      const runner = unitOf(cfg, "sword", "player", "s1", [3, 4], {
        hp: cfg.classes.sword.hp - 1,
      });
      // s1 first walks OUT of the healer's future adjacency — heal fails
      const away = applyMoves(
        stateWith(healer, runner),
        [
          moveOf(
            "s1",
            [
              [3, 4],
              [4, 4],
              [5, 4],
              [6, 4],
            ],
            { type: "wait" },
          ),
          moveOf("h1", [[2, 4]], { type: "heal", targetId: "s1" }),
        ],
        "player",
        cfg,
      );
      expect(away).toMatchObject({
        ok: false,
        error: "heal target must be adjacent and wounded",
      });

      // …and an ally walking INTO adjacency first makes the heal succeed
      const closer = unitOf(cfg, "spear", "player", "s2", [1, 4], {
        hp: cfg.classes.spear.hp - 1,
      });
      const success = applyMoves(
        stateWith(healer, closer),
        [
          moveOf(
            "s2",
            [
              [1, 4],
              [2, 4],
              [3, 4],
            ],
            { type: "wait" },
          ),
          moveOf("h1", [[2, 4]], { type: "heal", targetId: "s2" }),
        ],
        "player",
        cfg,
      );
      expect(success.ok).toBe(true);
      if (success.ok) {
        expect(success.result.events.map((e) => e.kind)).toEqual([
          "moved",
          "wait",
          "heal",
        ]);
      }
    });

    it("acted semantics: wait counts, omission leaves acted false", () => {
      const sword = unitOf(cfg, "sword", "player", "s1", [2, 4]);
      const spear = unitOf(cfg, "spear", "player", "s2", [1, 1]);
      const outcome = applyMoves(
        stateWith(sword, spear),
        [moveOf("s1", [[2, 4]], { type: "wait" })],
        "player",
        cfg,
      );
      expect(outcome.ok).toBe(true);
      if (outcome.ok) {
        const units = outcome.result.state.units;
        expect(units.find((u) => u.id === "s1")?.acted).toBe(true);
        expect(units.find((u) => u.id === "s2")?.acted).toBe(false);
      }
    });

    it("checkVictory: enemy wiped → player, player wiped → enemy, else null", () => {
      const s = unitOf(cfg, "sword", "player", "s1", [1, 1]);
      const e = unitOf(cfg, "axe", "enemy", "e1", [2, 1]);
      expect(checkVictory([s])).toBe("player");
      expect(checkVictory([e])).toBe("enemy");
      expect(checkVictory([s, e])).toBeNull();
    });
  });
}
