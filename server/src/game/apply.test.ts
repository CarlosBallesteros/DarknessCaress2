import { describe, expect, it } from "vitest";
import { applyMoves, checkVictory } from "./apply";
import {
  attack,
  e,
  engineConfig,
  heal,
  makeBoard,
  move,
  p,
  wait,
} from "./fixtures";
import type { GameEngineConfig } from "./types";

const cfg = engineConfig;

// Rebalances without touching the config file: proves the engine reads stats
// from GameEngineConfig, never from inline literals (docs/02 test list item 3).
function cfgWith(patch: (cfg: GameEngineConfig) => void): GameEngineConfig {
  const copy = JSON.parse(JSON.stringify(cfg)) as GameEngineConfig;
  patch(copy);
  return copy;
}

describe("attack, counter and the per-class distance matrix", () => {
  it("sword vs sword adjacent: damage = atk − def, mutual counters, acted flags set", () => {
    const board = makeBoard();
    const a = p("a", "sword", 5, 5);
    const b = e("b", "sword", 6, 5);
    const result = applyMoves(
      { board, units: [a, b] },
      [move("a", [[5, 5]], attack("b"))],
      "player",
      cfg,
    );
    expect(result).toStrictEqual({
      ok: true,
      result: {
        events: [
          {
            kind: "attack",
            attackerId: "a",
            targetId: "b",
            damage: 2,
            targetHp: 18,
          },
          {
            kind: "counter",
            attackerId: "a",
            targetId: "b",
            damage: 2,
            targetHp: 18,
          },
        ],
        state: {
          board: { tiles: board.tiles },
          units: [
            { ...a, hp: 18, acted: true },
            { ...b, hp: 18, acted: false },
          ],
        },
      },
    });
  });

  it("mage at distance 2 attacks with NO counter (sword range is 1)", () => {
    const board = makeBoard();
    const mage = p("m", "mage", 5, 5); // range [1,2,3], atk 8
    const sword = e("b", "sword", 7, 5); // range [1]
    const result = applyMoves(
      { board, units: [mage, sword] },
      [move("m", [[5, 5]], attack("b"))],
      "player",
      cfg,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.events).toStrictEqual([
      {
        kind: "attack",
        attackerId: "m",
        targetId: "b",
        damage: 3,
        targetHp: 17,
      },
    ]);
  });

  it("archers at distance 2 counter each other (range [2] is mutual there)", () => {
    const board = makeBoard();
    const a = p("a", "archer", 5, 5); // atk 6, def 2
    const b = e("b", "archer", 7, 5);
    const result = applyMoves(
      { board, units: [a, b] },
      [move("a", [[5, 5]], attack("b"))],
      "player",
      cfg,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.events).toStrictEqual([
      {
        kind: "attack",
        attackerId: "a",
        targetId: "b",
        damage: 4,
        targetHp: 12,
      },
      {
        kind: "counter",
        attackerId: "a",
        targetId: "b",
        damage: 4,
        targetHp: 12,
      },
    ]);
  });

  it("spearmen at distance 1 counter each other", () => {
    const board = makeBoard();
    const a = p("a", "spear", 5, 5); // atk 6, def 3
    const b = e("b", "spear", 6, 5);
    const result = applyMoves(
      { board, units: [a, b] },
      [move("a", [[5, 5]], attack("b"))],
      "player",
      cfg,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.events).toStrictEqual([
      {
        kind: "attack",
        attackerId: "a",
        targetId: "b",
        damage: 3,
        targetHp: 15,
      },
      {
        kind: "counter",
        attackerId: "a",
        targetId: "b",
        damage: 3,
        targetHp: 15,
      },
    ]);
  });

  it("the healer never counters and never attacks", () => {
    const board = makeBoard();
    const healer = p("h", "healer", 5, 5); // def 2, atk 0
    const sword = e("b", "sword", 6, 5);
    const result = applyMoves(
      { board, units: [healer, sword] },
      [move("b", [[6, 5]], attack("h"))],
      "enemy",
      cfg,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.events).toStrictEqual([
      {
        kind: "attack",
        attackerId: "b",
        targetId: "h",
        damage: 5,
        targetHp: 13,
      },
    ]);

    const refused = applyMoves(
      { board, units: [healer, sword] },
      [move("h", [[5, 5]], attack("b"))],
      "player",
      cfg,
    );
    expect(refused).toStrictEqual({ ok: false, error: "healer cannot attack" });
  });

  it("the counter can kill the attacker, and a dead attacker never counters back", () => {
    const board = makeBoard();
    const weak = p("a", "sword", 5, 5, { hp: 4 }); // axe counter deals 10 − 5 = 5
    const axe = e("b", "axe", 6, 5);
    const result = applyMoves(
      { board, units: [weak, axe] },
      [move("a", [[5, 5]], attack("b"))],
      "player",
      cfg,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.events).toStrictEqual([
      {
        kind: "attack",
        attackerId: "a",
        targetId: "b",
        damage: 4,
        targetHp: 21,
      },
      {
        kind: "counter",
        attackerId: "a",
        targetId: "b",
        damage: 5,
        targetHp: 0,
      },
      { kind: "died", unitId: "a" },
    ]);
    expect(result.result.state.units.map((u) => u.id)).toStrictEqual(["b"]);
  });

  it("damage floors at 0 — proven with a rebalanced config, not hardcoded math", () => {
    const weakConfig = cfgWith((c) => {
      c.classes.sword.atk = 3;
    });
    const board = makeBoard();
    const a = p("a", "sword", 5, 5); // atk 3
    const b = e("b", "sword", 6, 5); // def 5
    const result = applyMoves(
      { board, units: [a, b] },
      [move("a", [[5, 5]], attack("b"))],
      "player",
      weakConfig,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.events[0]).toStrictEqual({
      kind: "attack",
      attackerId: "a",
      targetId: "b",
      damage: 0,
      targetHp: 20,
    });
  });
});

describe("healing", () => {
  it("heals an adjacent wounded ally, clamped to maxHp", () => {
    const board = makeBoard();
    const healer = p("h", "healer", 5, 5);
    const ally = p("a", "sword", 5, 6, { hp: 15 }); // maxHp 20 → healed = min(8, 5) = 5
    const result = applyMoves(
      { board, units: [healer, ally] },
      [move("h", [[5, 5]], heal("a"))],
      "player",
      cfg,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.events).toStrictEqual([
      { kind: "heal", healerId: "h", targetId: "a", healed: 5, targetHp: 20 },
    ]);
    expect(result.result.state.units.find((u) => u.id === "a")?.hp).toBe(20);
  });

  it("rejects full-hp, non-adjacent and wrong-side heal targets", () => {
    const board = makeBoard();
    const healer = p("h", "healer", 5, 5);
    const healthy = p("a", "sword", 5, 6);
    const far = p("f", "spear", 5, 8, { hp: 3 });
    const enemy = e("b", "sword", 6, 5);
    const units = [healer, healthy, far, enemy];
    const state = { board, units };
    expect(
      applyMoves(state, [move("h", [[5, 5]], heal("a"))], "player", cfg),
    ).toStrictEqual({
      ok: false,
      error: "heal target must be adjacent and wounded",
    });
    expect(
      applyMoves(state, [move("h", [[5, 5]], heal("f"))], "player", cfg),
    ).toStrictEqual({
      ok: false,
      error: "heal target must be adjacent and wounded",
    });
    expect(
      applyMoves(state, [move("h", [[5, 5]], heal("b"))], "player", cfg),
    ).toStrictEqual({
      ok: false,
      error: "heal target must be adjacent and wounded",
    });
  });

  it("non-healer classes cannot heal", () => {
    const board = makeBoard();
    const spear = p("a", "spear", 5, 5);
    const ally = p("b", "sword", 5, 6, { hp: 10 });
    const result = applyMoves(
      { board, units: [spear, ally] },
      [move("a", [[5, 5]], heal("b"))],
      "player",
      cfg,
    );
    expect(result).toStrictEqual({ ok: false, error: "spear cannot heal" });
  });
});

describe("death and target validity", () => {
  it("a lethal attack removes the unit and skips its counter", () => {
    const board = makeBoard();
    const axe = p("a", "axe", 5, 5); // atk 10
    const frail = e("m", "mage", 6, 5, { hp: 9 }); // 10 − def 1 ≥ 9 → dies, no counter
    const result = applyMoves(
      { board, units: [axe, frail] },
      [move("a", [[5, 5]], attack("m"))],
      "player",
      cfg,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.events).toStrictEqual([
      {
        kind: "attack",
        attackerId: "a",
        targetId: "m",
        damage: 9,
        targetHp: 0,
      },
      { kind: "died", unitId: "m" },
    ]);
    expect(result.result.state.units.map((u) => u.id)).toStrictEqual(["a"]);
  });

  it("rejects attacks on dead (removed), wrong-side or out-of-range targets", () => {
    const board = makeBoard();
    const sword = p("a", "sword", 5, 5);
    const ally = p("c", "sword", 6, 5);
    const far = e("b", "sword", 9, 5); // distance 4 ∉ sword range [1]
    const state = { board, units: [sword, ally, far] };
    expect(
      applyMoves(state, [move("a", [[5, 5]], attack("ghost"))], "player", cfg),
    ).toStrictEqual({ ok: false, error: "unknown unit ghost" });
    expect(
      applyMoves(state, [move("a", [[5, 5]], attack("c"))], "player", cfg),
    ).toStrictEqual({ ok: false, error: "c is not a valid attack target" });
    expect(
      applyMoves(state, [move("a", [[5, 5]], attack("b"))], "player", cfg),
    ).toStrictEqual({
      ok: false,
      error: "sword cannot attack a unit at 4 tiles",
    });
  });

  it("range message uses the ACTING class key", () => {
    const board = makeBoard();
    const archer = p("a", "archer", 5, 5); // range [2]
    const adjacent = e("b", "sword", 6, 5);
    const result = applyMoves(
      { board, units: [archer, adjacent] },
      [move("a", [[5, 5]], attack("b"))],
      "player",
      cfg,
    );
    expect(result).toStrictEqual({
      ok: false,
      error: "archer cannot attack a unit at 1 tiles",
    });
  });
});

describe("acted semantics, duplicates and malformed entries", () => {
  it("wait entries count as acted; omitted units stay unacted", () => {
    const board = makeBoard();
    const a = p("a", "sword", 5, 5);
    const b = p("b", "spear", 6, 6);
    const result = applyMoves(
      { board, units: [a, b] },
      [move("a", [[5, 5]], wait)],
      "player",
      cfg,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.events).toStrictEqual([{ kind: "wait", unitId: "a" }]);
    expect(result.result.state.units.map((u) => u.acted)).toStrictEqual([
      true,
      false,
    ]);
  });

  it("rejects already-acted units and duplicate bundle entries", () => {
    const board = makeBoard();
    const a = p("a", "sword", 5, 5, { acted: true });
    const b = p("b", "sword", 6, 6);
    expect(
      applyMoves(
        { board, units: [a] },
        [move("a", [[5, 5]], wait)],
        "player",
        cfg,
      ),
    ).toStrictEqual({ ok: false, error: "a already acted this turn" });
    expect(
      applyMoves(
        { board, units: [b] },
        [move("b", [[6, 6]], wait), move("b", [[6, 6]], wait)],
        "player",
        cfg,
      ),
    ).toStrictEqual({ ok: false, error: "b appears twice" });
  });

  it("rejects unknown units and units of the other army", () => {
    const board = makeBoard();
    const mine = p("a", "sword", 5, 5);
    const theirs = e("b", "sword", 6, 5);
    expect(
      applyMoves(
        { board, units: [mine] },
        [move("ghost", [[5, 5]], wait)],
        "player",
        cfg,
      ),
    ).toStrictEqual({ ok: false, error: "unknown unit ghost" });
    expect(
      applyMoves(
        { board, units: [mine, theirs] },
        [move("b", [[6, 5]], wait)],
        "player",
        cfg,
      ),
    ).toStrictEqual({ ok: false, error: "b belongs to the other army" });
  });

  it("rejects unknown action types and missing targetIds", () => {
    const board = makeBoard();
    const a = p("a", "sword", 5, 5);
    const b = e("b", "sword", 6, 5);
    const healer = p("h", "healer", 5, 6);
    const state = { board, units: [a, b, healer] };
    expect(
      applyMoves(
        state,
        [move("a", [[5, 5]], { type: "dance" } as unknown as typeof wait)],
        "player",
        cfg,
      ),
    ).toStrictEqual({ ok: false, error: 'unknown action "dance"' });
    expect(
      applyMoves(
        state,
        [
          move("a", [[5, 5]], {
            type: "attack",
          } as unknown as { type: "attack"; targetId: string }),
        ],
        "player",
        cfg,
      ),
    ).toStrictEqual({ ok: false, error: "attack requires a target" });
    expect(
      applyMoves(
        state,
        [
          move("h", [[5, 6]], {
            type: "heal",
          } as unknown as { type: "heal"; targetId: string }),
        ],
        "player",
        cfg,
      ),
    ).toStrictEqual({ ok: false, error: "heal requires a target" });
  });
});

describe("evolving landing validation and bundle atomicity", () => {
  it("chain-following is LEGAL: a later entry lands on a tile an earlier entry vacated", () => {
    const board = makeBoard();
    const a = p("a", "sword", 5, 5);
    const b = p("b", "spear", 4, 5);
    const result = applyMoves(
      { board, units: [a, b] },
      [
        move(
          "a",
          [
            [5, 5],
            [6, 5],
          ],
          wait,
        ),
        move(
          "b",
          [
            [4, 5],
            [5, 5],
          ],
          wait,
        ),
      ],
      "player",
      cfg,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.state.units.find((u) => u.id === "a")?.x).toBe(6);
    expect(result.result.state.units.find((u) => u.id === "b")?.x).toBe(5);
  });

  it("two entries claiming ONE evolving tile still reject", () => {
    const board = makeBoard();
    const a = p("a", "sword", 5, 5);
    const b = p("b", "spear", 4, 5);
    const c = p("c", "axe", 4, 4);
    const result = applyMoves(
      { board, units: [a, b, c] },
      [
        move(
          "a",
          [
            [5, 5],
            [6, 5],
          ],
          wait,
        ),
        move(
          "b",
          [
            [4, 5],
            [5, 5],
          ],
          wait,
        ),
        move(
          "c",
          [
            [4, 4],
            [5, 4],
            [5, 5],
          ],
          wait,
        ),
      ],
      "player",
      cfg,
    );
    expect(result).toStrictEqual({
      ok: false,
      error: "tile (5,5) is claimed by two moves",
    });
  });

  it("landing on a tile still occupied in the evolving state rejects (ally and enemy)", () => {
    const board = makeBoard();
    const a = p("a", "sword", 5, 5);
    const ally = p("c", "axe", 5, 6);
    const enemy = e("b", "spear", 6, 5);
    expect(
      applyMoves(
        { board, units: [a, ally, enemy] },
        [
          move(
            "a",
            [
              [5, 5],
              [5, 6],
            ],
            wait,
          ),
        ],
        "player",
        cfg,
      ),
    ).toStrictEqual({
      ok: false,
      error: "tile (5,6) is occupied in the current position of the turn chain",
    });
    expect(
      applyMoves(
        { board, units: [a, ally, enemy] },
        [
          move(
            "a",
            [
              [5, 5],
              [6, 5],
            ],
            wait,
          ),
        ],
        "player",
        cfg,
      ),
    ).toStrictEqual({ ok: false, error: "path enters an enemy unit at (6,5)" });
  });

  it("a whole bundle is atomic: one bad entry leaves the caller's state untouched", () => {
    const board = makeBoard();
    const a = p("a", "sword", 5, 5);
    const b = p("b", "spear", 4, 5);
    const enemy = e("c", "axe", 9, 9);
    const state = { board, units: [a, b, enemy] };
    const snapshot = JSON.parse(JSON.stringify(state));
    const result = applyMoves(
      state,
      [
        move(
          "a",
          [
            [5, 5],
            [6, 5],
          ],
          wait,
        ), // would succeed alone
        move("b", [[4, 5]], attack("c")), // 9 tiles away — spear range is [1]
      ],
      "player",
      cfg,
    );
    expect(result.ok).toBe(false);
    expect(state).toStrictEqual(snapshot);
  });

  it("strict sequential resolution: a unit killed by a counter never executes its later entry", () => {
    const board = makeBoard();
    const weak = p("a", "sword", 5, 5, { hp: 4 }); // dies to the axe's counter below
    const axe = e("b", "axe", 6, 5);
    const state = { board, units: [weak, axe] };
    const snapshot = JSON.parse(JSON.stringify(state));
    const result = applyMoves(
      state,
      [
        move("a", [[5, 5]], attack("b")), // deals 4, the axe's counter deals 5 → "a" dies
        move("a", [[5, 5]], wait), // "a" was removed mid-chain — this entry must never execute
      ],
      "player",
      cfg,
    );
    expect(result).toStrictEqual({ ok: false, error: "unknown unit a" });
    expect(state).toStrictEqual(snapshot);
  });

  it("a target killed earlier in the chain rejects a later entry against the evolving state", () => {
    const board = makeBoard();
    const axe = p("a", "axe", 5, 5);
    const sword = p("b", "sword", 5, 4);
    const mage = e("m", "mage", 6, 5, { hp: 9 }); // dies to the first hit
    const state = { board, units: [axe, sword, mage] };
    const snapshot = JSON.parse(JSON.stringify(state));
    const result = applyMoves(
      state,
      [move("a", [[5, 5]], attack("m")), move("b", [[5, 4]], attack("m"))],
      "player",
      cfg,
    );
    expect(result).toStrictEqual({ ok: false, error: "unknown unit m" });
    expect(state).toStrictEqual(snapshot);
  });

  it("movement through a water tile rejects the bundle", () => {
    const board = makeBoard([[6, 5, "river"]]);
    const a = p("a", "sword", 5, 5);
    const result = applyMoves(
      { board, units: [a] },
      [
        move(
          "a",
          [
            [5, 5],
            [6, 5],
          ],
          wait,
        ),
      ],
      "player",
      cfg,
    );
    expect(result).toStrictEqual({
      ok: false,
      error: "path step (6,5) is water",
    });
  });

  it("a valid bundle reports events in strict entry order (moved then action)", () => {
    const board = makeBoard();
    const a = p("a", "sword", 5, 5);
    const b = e("b", "healer", 7, 5, { hp: 10 }); // moves adjacent, damage 7 − def 2 = 5; the healer never counters
    const result = applyMoves(
      { board, units: [a, b] },
      [
        move(
          "a",
          [
            [5, 5],
            [6, 5],
          ],
          attack("b"),
        ),
      ],
      "player",
      cfg,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.events.map((ev) => ev.kind)).toStrictEqual([
      "moved",
      "attack",
    ]);
    expect(result.result.state.units.find((u) => u.id === "a")).toMatchObject({
      x: 6,
      y: 5,
      acted: true,
    });
    expect(result.result.state.units.find((u) => u.id === "b")?.hp).toBe(5);
  });
});

describe("checkVictory", () => {
  it("returns player when the enemy army is wiped, enemy when the player army is wiped, null otherwise", () => {
    expect(checkVictory([p("a", "sword", 0, 0)])).toBe("player");
    expect(checkVictory([e("b", "sword", 1, 1)])).toBe("enemy");
    expect(
      checkVictory([p("a", "sword", 0, 0), e("b", "sword", 1, 1)]),
    ).toBeNull();
  });
});
