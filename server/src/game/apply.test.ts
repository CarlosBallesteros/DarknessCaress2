import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadGameEngineConfigFromFile, projectGameEngineConfig } from "../config/engine";
import type { Board, Move, Unit } from "./types";
import { applyMoves, checkVictory } from "./apply";

function loadCfg() {
  const p = process.env.GAME_CONFIG_PATH;
  if (p) return loadGameEngineConfigFromFile(p);
  return loadGameEngineConfigFromFile(path.resolve(__dirname, "../config/config.json"));
}

function boardEmpty(size = 8): Board {
  return {
    tiles: Array.from({ length: size }, () => Array.from({ length: size }, () => "plain" as const)),
  };
}

function u(partial: Partial<Unit> & Pick<Unit, "id" | "side" | "class" | "x" | "y">): Unit {
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

describe("applyMoves", () => {
  it("attack + counter per class distance matrix; healer never counters; damage floor at 0; heal clamping; death removes unit", () => {
    const cfg = loadCfg();
    const board = boardEmpty();

    // mage attacks at max range in config => range-1 melee target cannot counter if dist > 1
    const mageRangeDist = cfg.classes.mage.range.includes(3)
      ? 3
      : Math.max(...cfg.classes.mage.range);
    const mage = u({ id: "m1", side: "player", class: "mage", x: 0, y: 0 });
    const sword = u({ id: "e1", side: "enemy", class: "sword", x: 0, y: mageRangeDist });
    const r1 = applyMoves(
      { board, units: [mage, { ...sword }] },
      [{ unitId: "m1", path: [[0, 0]], action: { type: "attack", targetId: "e1" } }],
      "player",
      cfg,
    );
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      const canCounter = cfg.classes.sword.range.includes(mageRangeDist);
      expect(r1.result.events.some((e) => e.kind === "counter")).toBe(canCounter);
      const target = r1.result.state.units.find((x) => x.id === "e1")!;
      expect(target.hp).toBe(
        cfg.classes.sword.hp - Math.max(0, cfg.classes.mage.atk - cfg.classes.sword.def),
      );
    }

    // archer mutual counter at archer range distance
    const archerDist = cfg.classes.archer.range[0] ?? 2;
    const archer = u({ id: "a1", side: "player", class: "archer", x: 0, y: 0 });
    const archerE = u({ id: "a2", side: "enemy", class: "archer", x: 0, y: archerDist });
    const r2 = applyMoves(
      { board, units: [archer, archerE] },
      [{ unitId: "a1", path: [[0, 0]], action: { type: "attack", targetId: "a2" } }],
      "player",
      cfg,
    );
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      const canCounter = cfg.classes.archer.range.includes(archerDist);
      expect(r2.result.events.some((e) => e.kind === "counter")).toBe(canCounter);
    }

    // spear 1 mutual when range includes 1
    const spear = u({ id: "sp1", side: "player", class: "spear", x: 0, y: 0 });
    const spearE = u({ id: "sp2", side: "enemy", class: "spear", x: 0, y: 1 });
    const r3 = applyMoves(
      { board, units: [spear, spearE] },
      [{ unitId: "sp1", path: [[0, 0]], action: { type: "attack", targetId: "sp2" } }],
      "player",
      cfg,
    );
    expect(r3.ok).toBe(true);
    if (r3.ok) {
      expect(r3.result.events.some((e) => e.kind === "counter")).toBe(
        cfg.classes.spear.range.includes(1),
      );
    }

    // healer never counters (attacked at range 1 by sword)
    const sw = u({ id: "s1", side: "player", class: "sword", x: 0, y: 0 });
    const healer = u({ id: "h1", side: "enemy", class: "healer", x: 0, y: 1 });
    const r4 = applyMoves(
      { board, units: [sw, healer] },
      [{ unitId: "s1", path: [[0, 0]], action: { type: "attack", targetId: "h1" } }],
      "player",
      cfg,
    );
    expect(r4.ok).toBe(true);
    if (r4.ok) expect(r4.result.events.some((e) => e.kind === "counter")).toBe(false);

    // damage floor at 0 / config-derived damage
    const archerAtkDist = cfg.classes.archer.range[0] ?? 2;
    const weak = u({ id: "w1", side: "player", class: "archer", x: 0, y: 0 });
    const tank = u({
      id: "t1",
      side: "enemy",
      class: "axe",
      x: 0,
      y: archerAtkDist,
      hp: cfg.classes.axe.hp,
      maxHp: cfg.classes.axe.hp,
    });
    const r5 = applyMoves(
      { board, units: [weak, tank] },
      [{ unitId: "w1", path: [[0, 0]], action: { type: "attack", targetId: "t1" } }],
      "player",
      cfg,
    );
    expect(r5.ok).toBe(true);
    if (r5.ok) {
      const expected = Math.max(0, cfg.classes.archer.atk - cfg.classes.axe.def);
      const atkEvent = r5.result.events.find((e) => e.kind === "attack");
      expect(atkEvent && atkEvent.kind === "attack" ? atkEvent.damage : -1).toBe(expected);
      expect(atkEvent && atkEvent.kind === "attack" ? atkEvent.targetHp : -1).toBe(
        cfg.classes.axe.hp - expected,
      );
    }
    // explicit floor-at-0 case with mutated config
    const floorCfg = JSON.parse(JSON.stringify(loadCfg()));
    floorCfg.classes.archer.atk = 1;
    floorCfg.classes.axe.def = 99;
    const r5b = applyMoves(
      { board, units: [u({ id: "w2", side: "player", class: "archer", x: 0, y: 0 }), tank] },
      [{ unitId: "w2", path: [[0, 0]], action: { type: "attack", targetId: "t1" } }],
      "player",
      floorCfg,
    );
    expect(r5b.ok).toBe(true);
    if (r5b.ok) {
      const atkEvent = r5b.result.events.find((e) => e.kind === "attack");
      expect(atkEvent && atkEvent.kind === "attack" ? atkEvent.damage : -1).toBe(0);
    }

    // heal clamping and cannot attack
    const h = u({ id: "h2", side: "player", class: "healer", x: 1, y: 1 });
    const wounded = u({
      id: "p1",
      side: "player",
      class: "sword",
      x: 1,
      y: 2,
      hp: cfg.classes.sword.hp - 2,
      maxHp: cfg.classes.sword.hp,
    });
    const healRes = applyMoves(
      { board, units: [h, wounded] },
      [{ unitId: "h2", path: [[1, 1]], action: { type: "heal", targetId: "p1" } }],
      "player",
      cfg,
    );
    expect(healRes.ok).toBe(true);
    if (healRes.ok) {
      const tgt = healRes.result.state.units.find((x) => x.id === "p1")!;
      expect(tgt.hp).toBe(cfg.classes.sword.hp);
      const hev = healRes.result.events.find((e) => e.kind === "heal");
      expect(hev && hev.kind === "heal" ? hev.healed : -1).toBe(2);
    }

    // death removes unit
    const killer = u({ id: "k1", side: "player", class: "axe", x: 0, y: 0 });
    const victim = u({
      id: "v1",
      side: "enemy",
      class: "mage",
      x: 0,
      y: 1,
      hp: 1,
      maxHp: cfg.classes.mage.hp,
    });
    const dr = applyMoves(
      { board, units: [killer, victim] },
      [{ unitId: "k1", path: [[0, 0]], action: { type: "attack", targetId: "v1" } }],
      "player",
      cfg,
    );
    expect(dr.ok).toBe(true);
    if (dr.ok) {
      expect(dr.result.state.units.find((x) => x.id === "v1")).toBeUndefined();
      expect(dr.result.events.some((e) => e.kind === "died" && e.unitId === "v1")).toBe(true);
    }
  });

  it("healer cannot attack", () => {
    const cfg = loadCfg();
    const board = boardEmpty();
    const h = u({ id: "h1", side: "player", class: "healer", x: 0, y: 0 });
    const e = u({ id: "e1", side: "enemy", class: "sword", x: 0, y: 1 });
    const res = applyMoves(
      { board, units: [h, e] },
      [{ unitId: "h1", path: [[0, 0]], action: { type: "attack", targetId: "e1" } }],
      "player",
      cfg,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("healer cannot attack");
  });

  it("acted semantics; duplicate rejection; evolving landing validation; atomicity; sequential resolution", () => {
    const cfg = loadCfg();
    const board = boardEmpty();
    const a = u({ id: "a", side: "player", class: "spear", x: 0, y: 0 });
    const b = u({ id: "b", side: "player", class: "spear", x: 1, y: 0 });

    // chain-follow success: a vacates (0,0) moving to (0,1), b moves into (0,0)
    const chain = applyMoves(
      { board, units: [a, b] },
      [
        {
          unitId: "a",
          path: [
            [0, 0],
            [0, 1],
          ],
          action: { type: "wait" },
        },
        {
          unitId: "b",
          path: [
            [1, 0],
            [0, 0],
          ],
          action: { type: "wait" },
        },
      ],
      "player",
      cfg,
    );
    expect(chain.ok).toBe(true);
    if (chain.ok) {
      expect(chain.result.state.units.find((x) => x.id === "a")?.acted).toBe(true);
      expect(chain.result.state.units.find((x) => x.id === "b")?.acted).toBe(true);
    }

    // two entries claiming same evolving tile
    const clash = applyMoves(
      { board, units: [{ ...a }, { ...b, x: 0, y: 2 }] },
      [
        {
          unitId: "a",
          path: [
            [0, 0],
            [0, 1],
          ],
          action: { type: "wait" },
        },
        {
          unitId: "b",
          path: [
            [0, 2],
            [0, 1],
          ],
          action: { type: "wait" },
        },
      ],
      "player",
      cfg,
    );
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error).toBe("tile (0,1) is claimed by two moves");

    // entering/ending on still-occupied tile in evolving state
    const occ = applyMoves(
      { board, units: [{ ...a }, { ...b, x: 0, y: 1 }] },
      [
        {
          unitId: "a",
          path: [
            [0, 0],
            [0, 1],
          ],
          action: { type: "wait" },
        },
      ],
      "player",
      cfg,
    );
    expect(occ.ok).toBe(false);
    if (!occ.ok)
      expect(occ.error).toBe("tile (0,1) is occupied in the current position of the turn chain");

    // duplicate
    const dup = applyMoves(
      { board, units: [u({ id: "d", side: "player", class: "sword", x: 3, y: 3 })] },
      [
        { unitId: "d", path: [[3, 3]], action: { type: "wait" } },
        { unitId: "d", path: [[3, 3]], action: { type: "wait" } },
      ],
      "player",
      cfg,
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBe("d appears twice");

    // acted set for wait entry and atomicity on bad move
    const original = { board, units: [u({ id: "x", side: "player", class: "sword", x: 5, y: 5 })] };
    const bad: Move[] = [
      { unitId: "x", path: [[5, 5]], action: { type: "wait" } },
      { unitId: "missing", path: [[0, 0]], action: { type: "wait" } },
    ];
    const badRes = applyMoves(original, bad, "player", cfg);
    expect(badRes.ok).toBe(false);
    expect(original.units[0].acted).toBe(false);
    expect(original.units[0].x).toBe(5);

    // sequential resolution: a unit killed by a counter does not execute later entries
    // (cannot be the same unit twice due to duplicate rejection; validate guard with separate units)
    const fragile = u({ id: "frag", side: "player", class: "sword", x: 0, y: 0, hp: 1, maxHp: 20 });
    const strongCtr = u({
      id: "ctr",
      side: "enemy",
      class: "axe",
      x: 0,
      y: 1,
      hp: cfg.classes.axe.hp,
      maxHp: cfg.classes.axe.hp,
    });
    const victim2 = u({ id: "v2", side: "enemy", class: "mage", x: 1, y: 0, hp: 1, maxHp: 20 });
    // first: frag attacks ctr, dies to counter; second: frag would attack v2 but must not execute (frag dead)
    // we cannot submit frag twice, so simulate by ensuring implementation skips dead actors; direct state shows frag removed/died
    const seqState = applyMoves(
      { board, units: [fragile, strongCtr, victim2] },
      [{ unitId: "frag", path: [[0, 0]], action: { type: "attack", targetId: "ctr" } }],
      "player",
      cfg,
    );
    expect(seqState.ok).toBe(true);
    if (seqState.ok) {
      expect(seqState.result.state.units.find((x) => x.id === "frag")).toBeUndefined();
      expect(seqState.result.events.some((e) => e.kind === "counter")).toBe(true);
    }
  });

  it("victory check both directions", () => {
    const p = u({ id: "p", side: "player", class: "sword", x: 0, y: 0 });
    const e = u({ id: "e", side: "enemy", class: "sword", x: 1, y: 0 });
    expect(checkVictory([p])).toBe("player");
    expect(checkVictory([e])).toBe("enemy");
    expect(checkVictory([p, e])).toBeNull();
  });

  it("rejects missing targets, out of range, invalid targets, wrong side/unit states, and unknown actions with exact messages", () => {
    const cfg = loadCfg();
    const board = boardEmpty();
    const p = u({ id: "p1", side: "player", class: "archer", x: 0, y: 0 });
    const e = u({ id: "e1", side: "enemy", class: "sword", x: 0, y: 1 });
    expect(
      applyMoves(
        { board, units: [p, e] },
        [
          {
            unitId: "p1",
            path: [[0, 0]],
            action: { type: "attack", targetId: "" } as unknown as Move["action"],
          },
        ],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "attack requires a target" });

    const badDist = [1, 2, 3, 4].find((d) => !cfg.classes.archer.range.includes(d)) ?? 1;
    const eBad = u({ id: "e1b", side: "enemy", class: "sword", x: 0, y: badDist });
    expect(
      applyMoves(
        { board, units: [p, eBad] },
        [{ unitId: "p1", path: [[0, 0]], action: { type: "attack", targetId: "e1b" } }],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: `archer cannot attack a unit at ${badDist} tiles` });

    expect(
      applyMoves(
        { board, units: [p, e] },
        [{ unitId: "p1", path: [[0, 0]], action: { type: "attack", targetId: "nope" } }],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "unknown unit nope" });

    const p2 = u({ id: "p2", side: "player", class: "sword", x: 2, y: 2 });
    expect(
      applyMoves(
        { board, units: [p, p2] },
        [{ unitId: "p", path: [[0, 0]], action: { type: "wait" } }],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "unknown unit p" });

    const wrongSide = applyMoves(
      { board, units: [u({ id: "x", side: "enemy", class: "sword", x: 3, y: 3 })] },
      [{ unitId: "x", path: [[3, 3]], action: { type: "wait" } }],
      "player",
      cfg,
    );
    expect(wrongSide).toEqual({ ok: false, error: "x belongs to the other army" });

    const acted = applyMoves(
      { board, units: [u({ id: "y", side: "player", class: "sword", x: 4, y: 4, acted: true })] },
      [{ unitId: "y", path: [[4, 4]], action: { type: "wait" } }],
      "player",
      cfg,
    );
    expect(acted).toEqual({ ok: false, error: "y already acted this turn" });

    const healer = u({ id: "h1", side: "player", class: "healer", x: 1, y: 1 });
    const ally = u({
      id: "a1",
      side: "player",
      class: "sword",
      x: 1,
      y: 2,
      hp: cfg.classes.sword.hp,
      maxHp: cfg.classes.sword.hp,
    });
    expect(
      applyMoves(
        { board, units: [healer, ally] },
        [{ unitId: "h1", path: [[1, 1]], action: { type: "heal", targetId: "a1" } }],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "heal target must be adjacent and wounded" });

    expect(
      applyMoves(
        { board, units: [u({ id: "s1", side: "player", class: "sword", x: 6, y: 6 })] },
        [{ unitId: "s1", path: [[6, 6]], action: { type: "dance" } as unknown as Move["action"] }],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: 'unknown action "dance"' });

    const nonHealer = u({ id: "sw1", side: "player", class: "sword", x: 2, y: 2 });
    const ally2 = u({ id: "a2", side: "player", class: "sword", x: 2, y: 3, hp: 1, maxHp: 20 });
    expect(
      applyMoves(
        { board, units: [nonHealer, ally2] },
        [{ unitId: "sw1", path: [[2, 2]], action: { type: "heal", targetId: "a2" } }],
        "player",
        cfg,
      ),
    ).toEqual({ ok: false, error: "sword cannot heal" });
  });

  it("parametrized with real config values and works with mutated config projection", () => {
    const cfg = loadCfg();
    const board = boardEmpty();
    const mageDist = cfg.classes.mage.range.includes(3) ? 3 : Math.max(...cfg.classes.mage.range);
    const mage = u({ id: "m1", side: "player", class: "mage", x: 0, y: 0 });
    const sword = u({ id: "e1", side: "enemy", class: "sword", x: 0, y: mageDist });
    const res = applyMoves(
      { board, units: [mage, sword] },
      [{ unitId: "m1", path: [[0, 0]], action: { type: "attack", targetId: "e1" } }],
      "player",
      cfg,
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const expectedHp =
        cfg.classes.sword.hp - Math.max(0, cfg.classes.mage.atk - cfg.classes.sword.def);
      expect(res.result.state.units.find((x) => x.id === "e1")!.hp).toBe(expectedHp);
    }

    const basePath = path.resolve(__dirname, "../config/config.json");
    const mutated = JSON.parse(fs.readFileSync(basePath, "utf8")) as Parameters<
      typeof projectGameEngineConfig
    >[0];
    mutated.classes.sword.def = 0;
    mutated.classes.mage.atk = Math.max(1, (mutated.classes.mage.atk ?? 1) - 1);
    const mcfg = projectGameEngineConfig(mutated);
    const mDist = mcfg.classes.mage.range.includes(3) ? 3 : Math.max(...mcfg.classes.mage.range);
    const res2 = applyMoves(
      {
        board,
        units: [
          {
            id: "m1",
            side: "player",
            class: "mage",
            x: 0,
            y: 0,
            hp: mcfg.classes.mage.hp,
            maxHp: mcfg.classes.mage.hp,
            acted: false,
          },
          {
            id: "e1",
            side: "enemy",
            class: "sword",
            x: 0,
            y: mDist,
            hp: mcfg.classes.sword.hp,
            maxHp: mcfg.classes.sword.hp,
            acted: false,
          },
        ],
      },
      [{ unitId: "m1", path: [[0, 0]], action: { type: "attack", targetId: "e1" } }],
      "player",
      mcfg,
    );
    expect(res2.ok).toBe(true);
    if (res2.ok) {
      expect(res2.result.state.units.find((x) => x.id === "e1")!.hp).toBe(
        mcfg.classes.sword.hp - Math.max(0, mcfg.classes.mage.atk - mcfg.classes.sword.def),
      );
    }
  });
});
