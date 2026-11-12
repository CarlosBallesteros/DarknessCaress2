import { describe, expect, it } from "vitest";
import { config } from "../../config/index.js";
import { projectEngineConfig } from "../../game/config.js";
import { applyMoves } from "../../game/apply.js";
import { pathTo, previewMove } from "../../game/reach.js";
import type { Board, Tile, Unit } from "../../game/types.js";
import { computeEnemyOrders, type Difficulty } from "./policy.js";
import { expandOrdersToMoves } from "./aiTurn.js";

const engineConfig = projectEngineConfig(
  config as unknown as Parameters<typeof projectEngineConfig>[0],
);

function emptyBoard(size = engineConfig.boardSize): Board {
  const tiles: Tile[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => "plain" as Tile),
  );
  return { tiles };
}

function unit(partial: Partial<Unit> & Pick<Unit, "id" | "side" | "class" | "x" | "y">): Unit {
  const cls = engineConfig.classes[partial.class];
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

function applyPolicy(
  board: Board,
  units: Unit[],
  difficulty: Difficulty,
  rng?: () => number,
): ReturnType<typeof applyMoves> {
  const snapshot = units.map((u) => ({ ...u }));
  const orders = computeEnemyOrders(board, snapshot, difficulty, engineConfig, rng);
  // destination-only orders
  for (const o of orders) {
    expect(o.unitId).toBeTruthy();
    expect(["attack", "heal", "wait"]).toContain(o.action.type);
  }
  const moves = expandOrdersToMoves(board, snapshot, orders, engineConfig);
  // expanded moves have full paths
  for (const m of moves) {
    expect(m.path.length).toBeGreaterThan(0);
  }
  return applyMoves({ board, units: snapshot }, moves, "enemy", engineConfig);
}

describe("AI move policies (phase 5)", () => {
  it("aggressive/defensive/erratic produce only engine-legal, menu-valid bundles", () => {
    const board = emptyBoard();
    const units: Unit[] = [
      unit({ id: "E-sword-1", side: "enemy", class: "sword", x: 1, y: 0 }),
      unit({ id: "E-archer-1", side: "enemy", class: "archer", x: 3, y: 0 }),
      unit({ id: "E-healer-1", side: "enemy", class: "healer", x: 4, y: 0 }),
      unit({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 3 }),
      unit({ id: "P-archer-1", side: "player", class: "archer", x: 4, y: 3 }),
    ];

    for (const difficulty of ["aggressive", "defensive", "erratic"] as const) {
      // run a few times for erratic stability of legality
      for (let i = 0; i < 10; i++) {
        const result = applyPolicy(board, units, difficulty, () => (i * 0.17) % 1);
        expect(result.ok).toBe(true);
      }
    }
  });

  it("aggressive advances toward nearest player and prefers supporter targets when in range", () => {
    const board = emptyBoard();
    // Enemy swordsman can reach/attack player archer (supporter) this turn by advancing
    const units: Unit[] = [
      unit({ id: "E-sword-1", side: "enemy", class: "sword", x: 2, y: 1 }),
      unit({ id: "P-sword-1", side: "player", class: "sword", x: 2, y: 5, hp: 5 }),
      unit({ id: "P-archer-1", side: "player", class: "archer", x: 2, y: 4, hp: 20 }), // supporter, closer
    ];
    const snapshot = units.map((u) => ({ ...u }));
    const orders = computeEnemyOrders(board, snapshot, "aggressive", engineConfig);
    const order = orders.find((o) => o.unitId === "E-sword-1");
    expect(order).toBeDefined();
    // with no immediate attack from start? sword range 1, mov 3: can move to y4 and attack archer at (2,4) if adjacent -> moving onto (2,3) attacks (2,4)? distance from (2,3) to (2,4)=1
    // so should attack supporter archer if possible
    if (order?.action.type === "attack") {
      expect(order.action.targetId).toBe("P-archer-1");
    } else {
      // otherwise must advance closer to nearest player
      const toY = order?.to?.[1] ?? 1;
      expect(toY).toBeGreaterThan(1);
    }
    const applied = applyPolicy(board, units, "aggressive");
    expect(applied.ok).toBe(true);
  });

  it("defensive holds ground and avoids reckless advance when no safe attack", () => {
    const board = emptyBoard();
    const units: Unit[] = [
      unit({ id: "E-sword-1", side: "enemy", class: "sword", x: 2, y: 1 }),
      unit({ id: "P-sword-1", side: "player", class: "sword", x: 2, y: 6 }), // far away
    ];
    const snapshot = units.map((u) => ({ ...u }));
    const orders = computeEnemyOrders(board, snapshot, "defensive", engineConfig);
    const order = orders.find((o) => o.unitId === "E-sword-1");
    expect(order).toBeDefined();
    // no safe attack available (cannot attack without advancing closer into open, and likely no pair at all)
    // should stay on/near spawn side (top rows) and not rush forward
    const toY = order?.to?.[1] ?? 1;
    expect(toY).toBeLessThanOrEqual(2);
    expect(order?.action.type).toBe("wait");
  });

  it("erratic chooses only from legal options", () => {
    const board = emptyBoard();
    const units: Unit[] = [
      unit({ id: "E-archer-1", side: "enemy", class: "archer", x: 2, y: 1 }),
      unit({ id: "P-sword-1", side: "player", class: "sword", x: 2, y: 3 }),
    ];
    const snapshotBase = units.map((u) => ({ ...u }));
    for (let i = 0; i < 30; i++) {
      const snapshot = snapshotBase.map((u) => ({ ...u }));
      const orders = computeEnemyOrders(
        board,
        snapshot,
        "erratic",
        engineConfig,
        () => (i * 0.13) % 1,
      );
      const moves = expandOrdersToMoves(board, snapshot, orders, engineConfig);
      const applied = applyMoves({ board, units: snapshot }, moves, "enemy", engineConfig);
      expect(applied.ok).toBe(true);
      // every move path must be legal in isolation from pre-move snapshot context? moves were expanded against evolving snapshot and applied fine
    }
  });

  it("destination-only orders expand via pathTo and are menu-derived", () => {
    const board = emptyBoard();
    const units: Unit[] = [
      unit({ id: "E-sword-1", side: "enemy", class: "sword", x: 2, y: 1 }),
      unit({ id: "P-sword-1", side: "player", class: "sword", x: 2, y: 4 }),
    ];
    const snapshot = units.map((u) => ({ ...u }));
    const orders = computeEnemyOrders(board, snapshot, "aggressive", engineConfig);
    const order = orders[0];
    expect(order).toBeDefined();
    const to = order.to ?? [2, 1];
    const expectedPath = pathTo(board, units, units[0], to, engineConfig);
    const moves = expandOrdersToMoves(board, units, orders, engineConfig);
    expect(moves[0].path).toEqual(expectedPath);
    // destination must be reachable/menu-valid tile
    const preview = previewMove(board, units, units[0], engineConfig);
    const reachableKeys = new Set(preview.moveTiles.map((t) => `${t[0]},${t[1]}`));
    expect(reachableKeys.has(`${to[0]},${to[1]}`)).toBe(true);
  });
});
