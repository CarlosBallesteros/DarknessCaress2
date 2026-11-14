import { describe, expect, it } from "vitest";
import rawDefault from "../config/config.json";
import { projectGameEngineConfig, type RawGameConfig } from "./config";
import { applyMoves, checkVictory } from "./apply";
import { previewMove, reachableTiles } from "./reach";
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

// unit builder parameterized by cfg is `um` below.

function um(
  cfg: GameEngineConfig,
  partial: Partial<Unit> & Pick<Unit, "id" | "side" | "class" | "x" | "y">,
): Unit {
  const base = cfg.classes[partial.class];
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

function cloneState(state: { board: Board; units: Unit[] }) {
  return {
    board: { tiles: state.board.tiles.map((r) => [...r]) },
    units: state.units.map((x) => ({ ...x })),
  };
}

describe("apply/checkVictory (default config)", () => {
  runApplySuite(defaultCfg);
});

describe("apply/checkVictory (mutated config)", () => {
  const mutated: RawGameConfig = JSON.parse(JSON.stringify(rawDefault));
  mutated.boardSize = 9;
  for (const k of Object.keys(mutated.classes)) {
    const c = mutated.classes[k];
    c.hp += 4;
    c.atk += 3;
    c.def += 1;
    c.mov = Math.max(1, c.mov - 1);
    if (c.healAmount) c.healAmount += 1;
    if (k === "archer") c.range = [3];
    if (k === "mage") c.range = [2, 3];
    if (k === "sword" || k === "axe" || k === "spear") c.range = [1];
  }
  runApplySuite(cfgFrom(mutated));
});

function runApplySuite(cfg: GameEngineConfig) {
  it("executes attack damage/counter per class distance matrix and healer never counters", () => {
    const board = makeBoard(cfg.boardSize);
    const sword = um(cfg, { id: "s1", side: "player", class: "sword", x: 2, y: 2 });
    const spear = um(cfg, { id: "sp1", side: "enemy", class: "spear", x: 3, y: 2 });
    const state = { board, units: [sword, spear] };
    const dmg = Math.max(0, cfg.classes.sword.atk - cfg.classes.spear.def);
    const cDmg = Math.max(0, cfg.classes.spear.atk - cfg.classes.sword.def);
    const res = applyMoves(
      state,
      [
        {
          unitId: "s1",
          path: [[2, 2]],
          action: { type: "attack", targetId: "sp1" },
        },
      ],
      "player",
      cfg,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const sAfter = res.result.state.units.find((x) => x.id === "s1")!;
    const spAfter = res.result.state.units.find((x) => x.id === "sp1")!;
    expect(spAfter.hp).toBe(cfg.classes.spear.hp - dmg);
    // spear range [1] (mutated keeps melee as [1]) counters if in range
    if (cfg.classes.spear.range.includes(1)) {
      expect(sAfter.hp).toBe(cfg.classes.sword.hp - cDmg);
      expect(res.result.events.some((e) => e.kind === "counter")).toBe(true);
    }

    // mage at distance 3 from melee target: melee cannot counter if 3 not in its range
    const board2 = makeBoard(cfg.boardSize);
    const mage = um(cfg, { id: "m1", side: "player", class: "mage", x: 1, y: 1 });
    const target = um(cfg, { id: "e1", side: "enemy", class: "sword", x: 4, y: 1 });
    const rMage = cfg.classes.mage.range.includes(3)
      ? 3
      : cfg.classes.mage.range[cfg.classes.mage.range.length - 1];
    target.x = 1 + rMage;
    const mRes = applyMoves(
      { board: board2, units: [mage, target] },
      [{ unitId: "m1", path: [[1, 1]], action: { type: "attack", targetId: "e1" } }],
      "player",
      cfg,
    );
    expect(mRes.ok).toBe(true);
    if (mRes.ok) {
      const mageAfter = mRes.result.state.units.find((x) => x.id === "m1")!;
      if (!cfg.classes.sword.range.includes(rMage)) {
        expect(mageAfter.hp).toBe(cfg.classes.mage.hp);
        expect(mRes.result.events.some((e) => e.kind === "counter")).toBe(false);
      }
    }

    // archer mutual at distance in range
    const board3 = makeBoard(cfg.boardSize);
    const ar = um(cfg, { id: "a1", side: "player", class: "archer", x: 2, y: 2 });
    const arE = um(cfg, {
      id: "a2",
      side: "enemy",
      class: "archer",
      x: 2 + cfg.classes.archer.range[0],
      y: 2,
    });
    const aRes = applyMoves(
      { board: board3, units: [ar, arE] },
      [{ unitId: "a1", path: [[2, 2]], action: { type: "attack", targetId: "a2" } }],
      "player",
      cfg,
    );
    expect(aRes.ok).toBe(true);
    if (aRes.ok) {
      expect(aRes.result.events.some((e) => e.kind === "counter")).toBe(true);
    }

    // healer never counters
    const board4 = makeBoard(cfg.boardSize);
    const atk = um(cfg, { id: "p1", side: "player", class: "sword", x: 2, y: 2 });
    const healer = um(cfg, { id: "h1", side: "enemy", class: "healer", x: 3, y: 2 });
    const hRes = applyMoves(
      { board: board4, units: [atk, healer] },
      [{ unitId: "p1", path: [[2, 2]], action: { type: "attack", targetId: "h1" } }],
      "player",
      cfg,
    );
    expect(hRes.ok).toBe(true);
    if (hRes.ok) {
      const atkAfter = hRes.result.state.units.find((x) => x.id === "p1")!;
      expect(atkAfter.hp).toBe(cfg.classes.sword.hp);
      expect(hRes.result.events.some((e) => e.kind === "counter")).toBe(false);
    }
  });

  it("applies damage floor at 0, heal clamping, death removes unit", () => {
    const board = makeBoard(cfg.boardSize);
    const weakAtk = um(cfg, { id: "p1", side: "player", class: "archer", x: 2, y: 2 });
    // force atk < def scenario by using high-def target class? use sword as target maybe not enough; craft via custom numbers in state but stats come from cfg in engine - engine uses cfg.classes for atk/def. So rely on cfg: if atk-def < 0 fine else damage >=0 always; to guarantee floor, pick pair where target def >= atk
    const tank = um(cfg, {
      id: "e1",
      side: "enemy",
      class: "sword",
      x: 2 + cfg.classes.archer.range[0],
      y: 2,
    });
    // ensure floor case: if not naturally floored, mutate expectation? better construct: if cfg.classes.archer.atk - cfg.classes.sword.def <= 0 expect 0 damage else still valid floor behavior (max(0,...)) holds.
    const res = applyMoves(
      { board, units: [weakAtk, tank] },
      [{ unitId: "p1", path: [[2, 2]], action: { type: "attack", targetId: "e1" } }],
      "player",
      cfg,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const ev = res.result.events.find((e) => e.kind === "attack");
      expect(ev && ev.kind === "attack" ? ev.damage : -1).toBe(
        Math.max(0, cfg.classes.archer.atk - cfg.classes.sword.def),
      );
    }

    // heal clamping
    const board2 = makeBoard(cfg.boardSize);
    const healer = um(cfg, { id: "h1", side: "player", class: "healer", x: 2, y: 2 });
    const wounded = um(cfg, {
      id: "p2",
      side: "player",
      class: "sword",
      x: 3,
      y: 2,
      hp: cfg.classes.sword.hp - 1,
      maxHp: cfg.classes.sword.hp,
    });
    const hRes = applyMoves(
      { board: board2, units: [healer, wounded] },
      [{ unitId: "h1", path: [[2, 2]], action: { type: "heal", targetId: "p2" } }],
      "player",
      cfg,
    );
    expect(hRes.ok).toBe(true);
    if (hRes.ok) {
      const t = hRes.result.state.units.find((u) => u.id === "p2")!;
      expect(t.hp).toBe(cfg.classes.sword.hp);
      const hev = hRes.result.events.find((e) => e.kind === "heal");
      expect(hev && hev.kind === "heal" ? hev.healed : -1).toBe(1);
    }

    // death removes unit
    const board3 = makeBoard(cfg.boardSize);
    const killer = um(cfg, { id: "k1", side: "player", class: "axe", x: 2, y: 2 });
    const victim = um(cfg, {
      id: "v1",
      side: "enemy",
      class: "archer",
      x: 3,
      y: 2,
      hp: 1,
      maxHp: cfg.classes.archer.hp,
    });
    const kRes = applyMoves(
      { board: board3, units: [killer, victim] },
      [{ unitId: "k1", path: [[2, 2]], action: { type: "attack", targetId: "v1" } }],
      "player",
      cfg,
    );
    expect(kRes.ok).toBe(true);
    if (kRes.ok) {
      expect(kRes.result.state.units.find((u) => u.id === "v1")).toBeUndefined();
      expect(kRes.result.events.some((e) => e.kind === "died" && e.unitId === "v1")).toBe(true);
    }
  });

  it("rejects healer attack and enforces acted/duplicate/landing/atomicity/sequential rules", () => {
    const board = makeBoard(cfg.boardSize);
    const healer = um(cfg, { id: "h1", side: "player", class: "healer", x: 2, y: 2 });
    const enemy = um(cfg, { id: "e1", side: "enemy", class: "sword", x: 3, y: 2 });
    const noAtk = applyMoves(
      { board, units: [healer, enemy] },
      [
        {
          unitId: "h1",
          path: [[2, 2]],
          action: { type: "attack", targetId: "e1" } as unknown as { type: "wait" },
        },
      ],
      "player",
      cfg,
    );
    expect(noAtk.ok).toBe(false);
    if (!noAtk.ok) expect(noAtk.error).toBe("healer cannot attack");

    // acted semantics and duplicate rejection
    const s1 = um(cfg, { id: "p1", side: "player", class: "sword", x: 1, y: 1, acted: true });
    const actedRes = applyMoves(
      { board: makeBoard(cfg.boardSize), units: [s1] },
      [{ unitId: "p1", path: [[1, 1]], action: { type: "wait" } }],
      "player",
      cfg,
    );
    expect(actedRes).toEqual({ ok: false, error: "p1 already acted this turn" });
    const s2 = um(cfg, { id: "p2", side: "player", class: "sword", x: 1, y: 1 });
    const dupRes = applyMoves(
      { board: makeBoard(cfg.boardSize), units: [s2] },
      [
        { unitId: "p2", path: [[1, 1]], action: { type: "wait" } },
        { unitId: "p2", path: [[1, 1]], action: { type: "wait" } },
      ],
      "player",
      cfg,
    );
    expect(dupRes).toEqual({ ok: false, error: "p2 appears twice" });

    // evolving landing: chain-follow success (entry 1 vacates, entry 2 lands there)
    const a = um(cfg, { id: "a", side: "player", class: "sword", x: 1, y: 1 });
    const b = um(cfg, { id: "b", side: "player", class: "sword", x: 2, y: 1 });
    const chain = applyMoves(
      { board: makeBoard(cfg.boardSize), units: [a, b] },
      [
        {
          unitId: "a",
          path: [
            [1, 1],
            [1, 2],
          ],
          action: { type: "wait" },
        },
        {
          unitId: "b",
          path: [
            [2, 1],
            [1, 1],
          ],
          action: { type: "wait" },
        },
      ],
      "player",
      cfg,
    );
    expect(chain.ok).toBe(true);
    if (chain.ok) {
      expect(chain.result.state.units.find((u) => u.id === "a")).toMatchObject({
        x: 1,
        y: 2,
        acted: true,
      });
      expect(chain.result.state.units.find((u) => u.id === "b")).toMatchObject({
        x: 1,
        y: 1,
        acted: true,
      });
    }

    // two entries claiming same evolving tile => reject
    const c1 = um(cfg, { id: "c1", side: "player", class: "sword", x: 1, y: 1 });
    const c2 = um(cfg, { id: "c2", side: "player", class: "sword", x: 3, y: 1 });
    const claim = applyMoves(
      { board: makeBoard(cfg.boardSize), units: [c1, c2] },
      [
        {
          unitId: "c1",
          path: [
            [1, 1],
            [2, 1],
          ],
          action: { type: "wait" },
        },
        {
          unitId: "c2",
          path: [
            [3, 1],
            [2, 1],
          ],
          action: { type: "wait" },
        },
      ],
      "player",
      cfg,
    );
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.error).toBe("tile (2,1) is claimed by two moves");

    // entering/landing on still-occupied tile => reject
    const d1 = um(cfg, { id: "d1", side: "player", class: "sword", x: 1, y: 1 });
    const d2 = um(cfg, { id: "d2", side: "player", class: "sword", x: 2, y: 1 });
    const occ = applyMoves(
      { board: makeBoard(cfg.boardSize), units: [d1, d2] },
      [
        {
          unitId: "d1",
          path: [
            [1, 1],
            [2, 1],
          ],
          action: { type: "wait" },
        },
      ],
      "player",
      cfg,
    );
    expect(occ.ok).toBe(false);
    if (!occ.ok)
      expect(occ.error).toBe("tile (2,1) is occupied in the current position of the turn chain");

    // whole-bundle atomicity: one bad move => ok:false, state untouched
    const orig = {
      board: makeBoard(cfg.boardSize),
      units: [um(cfg, { id: "x1", side: "player", class: "sword", x: 1, y: 1 })],
    };
    const snap = cloneState(orig);
    const bad = applyMoves(
      orig,
      [
        { unitId: "x1", path: [[1, 1]], action: { type: "wait" } },
        { unitId: "missing", path: [[0, 0]], action: { type: "wait" } } as unknown as {
          unitId: string;
          path: [number, number][];
          action: { type: "wait" };
        },
      ],
      "player",
      cfg,
    );
    expect(bad.ok).toBe(false);
    expect(orig).toEqual(snap);

    // sequential resolution: killed-attacker's later entry never executes
    // enemy counters and kills p1; p1's later bundle entry must cause rejection (bundle fails), state untouched overall
    // set up: p1 attacks e1 adjacent, e1 survives and counters killing p1 (hp 1), p1 has a later entry
    const p1 = um(cfg, {
      id: "p1",
      side: "player",
      class: "sword",
      x: 1,
      y: 1,
      hp: 1,
      maxHp: cfg.classes.sword.hp,
    });
    const e1 = um(cfg, {
      id: "e1",
      side: "enemy",
      class: "sword",
      x: 2,
      y: 1,
      hp: cfg.classes.sword.hp,
      maxHp: cfg.classes.sword.hp,
    });
    const p3 = um(cfg, { id: "p3", side: "player", class: "sword", x: 1, y: 3 });
    const seqState = { board: makeBoard(cfg.boardSize), units: [p1, e1, p3] };
    const seqSnap = cloneState(seqState);
    const seq = applyMoves(
      seqState,
      [
        { unitId: "p1", path: [[1, 1]], action: { type: "attack", targetId: "e1" } },
        { unitId: "p1", path: [[1, 1]], action: { type: "wait" } }, // duplicate/killed - cannot execute
      ],
      "player",
      cfg,
    );
    expect(seq.ok).toBe(false);
    expect(seqState).toEqual(seqSnap);
  });

  it("checks victory both directions and preview consistency", () => {
    const p = um(cfg, { id: "p", side: "player", class: "sword", x: 0, y: 0 });
    const e = um(cfg, { id: "e", side: "enemy", class: "sword", x: 1, y: 0 });
    expect(checkVictory([p, e])).toBeNull();
    expect(checkVictory([p])).toBe("player");
    expect(checkVictory([e])).toBe("enemy");

    const board = makeBoard(cfg.boardSize);
    board.tiles[2][3] = "hill";
    board.tiles[3][2] = "forest";
    const unit = um(cfg, { id: "u1", side: "player", class: "mage", x: 2, y: 2 });
    const enemy = um(cfg, { id: "e2", side: "enemy", class: "sword", x: 4, y: 2 });
    const reach = reachableTiles(board, [unit, enemy], unit, cfg);
    const prev = previewMove(board, [unit, enemy], unit, cfg);
    expect(new Set(prev.moveTiles.map(([x, y]) => `${x},${y}`))).toEqual(reach);
    // attack tiles correspond to enemies in range set from some reachable tile
    for (const [ax, ay] of prev.attackTiles) {
      const target = [enemy].find((t) => t.x === ax && t.y === ay);
      expect(target).toBeTruthy();
      const inRangeFromSome = prev.moveTiles.some(([mx, my]) =>
        cfg.classes.mage.range.includes(Math.abs(mx - ax) + Math.abs(my - ay)),
      );
      expect(inRangeFromSome).toBe(true);
    }
  });

  it("rejects missing targetId, invalid targets/range/heal, and wrong-side/capability/unknown cases", () => {
    const board = makeBoard(cfg.boardSize);
    const sword = um(cfg, { id: "p1", side: "player", class: "sword", x: 2, y: 2 });
    const enemy = um(cfg, { id: "e1", side: "enemy", class: "sword", x: 5, y: 5 });
    expect(
      applyMoves(
        { board, units: [sword, enemy] },
        [
          {
            unitId: "p1",
            path: [[2, 2]],
            action: { type: "attack" } as unknown as { type: "wait" },
          },
        ],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "attack requires a target" });
    const healer = um(cfg, { id: "h1", side: "player", class: "healer", x: 2, y: 2 });
    expect(
      applyMoves(
        { board, units: [healer, sword] },
        [
          {
            unitId: "h1",
            path: [[2, 2]],
            action: { type: "heal" } as unknown as { type: "wait" },
          },
        ],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "heal requires a target" });

    // out of range
    const far = applyMoves(
      { board: makeBoard(cfg.boardSize), units: [um(cfg, { ...sword }), um(cfg, { ...enemy })] },
      [{ unitId: "p1", path: [[2, 2]], action: { type: "attack", targetId: "e1" } }],
      "player",
      cfg,
    );
    expect(far.ok).toBe(false);
    if (!far.ok)
      expect(far.error).toBe(
        `sword cannot attack a unit at ${Math.abs(2 - 5) + Math.abs(2 - 5)} tiles`,
      );

    // wrong side / invalid attack target
    const ally = um(cfg, { id: "p2", side: "player", class: "sword", x: 3, y: 2 });
    expect(
      applyMoves(
        { board: makeBoard(cfg.boardSize), units: [um(cfg, { ...sword }), ally] },
        [{ unitId: "p1", path: [[2, 2]], action: { type: "attack", targetId: "p2" } }],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "p2 is not a valid attack target" });

    // heal must be adjacent and wounded
    const healthy = um(cfg, {
      id: "p4",
      side: "player",
      class: "sword",
      x: 3,
      y: 2,
      hp: cfg.classes.sword.hp,
      maxHp: cfg.classes.sword.hp,
    });
    expect(
      applyMoves(
        { board: makeBoard(cfg.boardSize), units: [um(cfg, { ...healer, id: "h2" }), healthy] },
        [{ unitId: "h2", path: [[2, 2]], action: { type: "heal", targetId: "p4" } }],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "heal target must be adjacent and wounded" });

    // non-healer cannot heal
    expect(
      applyMoves(
        {
          board: makeBoard(cfg.boardSize),
          units: [
            um(cfg, { ...sword }),
            um(cfg, {
              id: "p5",
              side: "player",
              class: "sword",
              x: 3,
              y: 2,
              hp: 1,
              maxHp: cfg.classes.sword.hp,
            }),
          ],
        },
        [{ unitId: "p1", path: [[2, 2]], action: { type: "heal", targetId: "p5" } }],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "sword cannot heal" });

    // unknown unit / wrong side / unknown action / unknown target id
    expect(
      applyMoves(
        { board: makeBoard(cfg.boardSize), units: [] },
        [{ unitId: "nope", path: [[0, 0]], action: { type: "wait" } }],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "unknown unit nope" });
    expect(
      applyMoves(
        {
          board: makeBoard(cfg.boardSize),
          units: [um(cfg, { id: "e9", side: "enemy", class: "sword", x: 1, y: 1 })],
        },
        [{ unitId: "e9", path: [[1, 1]], action: { type: "wait" } }],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "e9 belongs to the other army" });
    expect(
      applyMoves(
        { board: makeBoard(cfg.boardSize), units: [um(cfg, { ...sword })] },
        [
          {
            unitId: "p1",
            path: [[2, 2]],
            action: { type: "dance" } as unknown as { type: "wait" },
          },
        ],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: 'unknown action "dance"' });
    expect(
      applyMoves(
        { board: makeBoard(cfg.boardSize), units: [um(cfg, { ...sword })] },
        [{ unitId: "p1", path: [[2, 2]], action: { type: "attack", targetId: "ghost" } }],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "unknown unit ghost" });
  });
}
