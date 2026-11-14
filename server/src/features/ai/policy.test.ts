import { describe, expect, it } from "vitest";
import { chooseOrderForUnit } from "./policy";
import { pathTo, previewMove } from "../../game/reach";
import { applyMoves } from "../../game/apply";
import type { Board, GameEngineConfig, Unit } from "../../game/types";

const cfg: GameEngineConfig = {
  boardSize: 8,
  classes: {
    sword: { count: 2, hp: 15, atk: 8, def: 3, mov: 3, range: [1], role: "attacker" },
    axe: { count: 2, hp: 13, atk: 10, def: 2, mov: 2, range: [1], role: "attacker" },
    spear: { count: 2, hp: 10, atk: 7, def: 2, mov: 5, range: [1], role: "attacker" },
    archer: { count: 2, hp: 9, atk: 7, def: 1, mov: 4, range: [2], role: "supporter" },
    mage: { count: 1, hp: 9, atk: 9, def: 1, mov: 3, range: [1, 2, 3], role: "supporter" },
    healer: {
      count: 1,
      hp: 10,
      atk: 0,
      def: 1,
      mov: 2,
      range: [],
      healAmount: 6,
      role: "supporter",
    },
  },
};

function plainBoard(): Board {
  return {
    tiles: Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "plain" as const)),
  };
}

function isMenuLegalAttack(
  unit: Unit,
  target: Unit,
  to: [number, number],
  units: Unit[],
  board: Board,
): boolean {
  const preview = previewMove(board, units, unit, cfg);
  const reachable = new Set(preview.moveTiles.map(([x, y]) => `${x},${y}`));
  if (!reachable.has(`${to[0]},${to[1]}`)) return false;
  const dist = Math.abs(to[0] - target.x) + Math.abs(to[1] - target.y);
  return cfg.classes[unit.class].range.includes(dist);
}

describe("AI policies", () => {
  it("aggressive/defensive/erratic produce engine-legal, menu-valid orders expanded via pathTo", () => {
    const board = plainBoard();
    const baseUnits: Unit[] = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 4,
        y: 5,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "P-archer-1",
        side: "player",
        class: "archer",
        x: 6,
        y: 5,
        hp: 9,
        maxHp: 9,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 4,
        y: 3,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "E-archer-1",
        side: "enemy",
        class: "archer",
        x: 2,
        y: 1,
        hp: 9,
        maxHp: 9,
        acted: false,
      },
      {
        id: "E-healer-1",
        side: "enemy",
        class: "healer",
        x: 3,
        y: 0,
        hp: 7,
        maxHp: 10,
        acted: false,
      },
      { id: "E-axe-1", side: "enemy", class: "axe", x: 5, y: 1, hp: 13, maxHp: 13, acted: false },
    ];

    for (const difficulty of ["aggressive", "defensive", "erratic"] as const) {
      for (let seed = 0; seed < 5; seed++) {
        let units = baseUnits.map((u) => ({ ...u }));
        const claimed = new Set<string>();
        // simple deterministic rng for erratic reproducibility
        let s = seed + 1;
        const rng = () => {
          s = (s * 1664525 + 1013904223) % 4294967296;
          return s / 4294967296;
        };
        for (const enemyId of units
          .filter((u) => u.side === "enemy")
          .map((u) => u.id)
          .sort()) {
          const unit = units.find((u) => u.id === enemyId)!;
          if (unit.hp <= 0) continue;
          const order = chooseOrderForUnit({
            board,
            units,
            unit,
            difficulty,
            cfg,
            claimed,
            rng,
          });
          const to = order.to ?? [unit.x, unit.y];
          const path = pathTo(board, units, unit, [to[0], to[1]], cfg);
          expect(path, `${difficulty} ${enemyId} path`).not.toBeNull();
          const act = order.action;
          if (act.type === "attack") {
            const target = units.find((u) => u.id === act.targetId)!;
            expect(target.side).toBe("player");
            expect(isMenuLegalAttack(unit, target, [to[0], to[1]], units, board)).toBe(true);
          }
          if (act.type === "heal") {
            const target = units.find((u) => u.id === act.targetId)!;
            expect(target.side).toBe("enemy");
          }
          const res = applyMoves(
            { board, units },
            [{ unitId: unit.id, path: path!, action: order.action }],
            "enemy",
            cfg,
          );
          expect(
            res.ok,
            `${difficulty} ${enemyId} ${JSON.stringify(order)} ${JSON.stringify(res)}`,
          ).toBe(true);
          if (res.ok) {
            units = res.result.state.units;
            const survivor = units.find((u) => u.id === enemyId && u.side === "enemy" && u.hp > 0);
            if (survivor) claimed.add(`${survivor.x},${survivor.y}`);
          }
        }
      }
    }
  });

  it("aggressive intent: prefers supporter target and advances when no attack pairs", () => {
    const board = plainBoard();
    // supporter (archer) and non-supporter (sword) both attackable; supporter has higher hp but should be preferred
    const units: Unit[] = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 3,
        y: 4,
        hp: 5,
        maxHp: 15,
        acted: false,
      },
      {
        id: "P-archer-1",
        side: "player",
        class: "archer",
        x: 4,
        y: 4,
        hp: 9,
        maxHp: 9,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 4,
        y: 3,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
    ];
    const order = chooseOrderForUnit({
      board,
      units,
      unit: units.find((u) => u.id === "E-sword-1")!,
      difficulty: "aggressive",
      cfg,
      claimed: new Set(),
    });
    expect(order.action.type).toBe("attack");
    if (order.action.type === "attack") {
      expect(order.action.targetId).toBe("P-archer-1"); // supporter preferred
    }

    // no attack pairs -> advance toward nearest player
    const far: Unit[] = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 4,
        y: 7,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 4,
        y: 1,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
    ];
    const adv = chooseOrderForUnit({
      board,
      units: far,
      unit: far[1],
      difficulty: "aggressive",
      cfg,
      claimed: new Set(),
    });
    expect(adv.action.type).toBe("wait");
    const to = adv.to ?? [4, 1];
    expect(to[1]).toBeGreaterThan(1); // moved down toward player
  });

  it("defensive intent: holds ground/back and does not needlessly advance into danger", () => {
    const board = plainBoard();
    const units: Unit[] = [
      {
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 4,
        y: 6,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
      {
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 4,
        y: 2,
        hp: 15,
        maxHp: 15,
        acted: false,
      },
    ];
    const order = chooseOrderForUnit({
      board,
      units,
      unit: units[1],
      difficulty: "defensive",
      cfg,
      claimed: new Set(),
    });
    const to = order.to ?? [4, 2];
    expect(to[1]).toBeLessThanOrEqual(2); // stays back/top, does not advance toward player at y=6
  });
});
