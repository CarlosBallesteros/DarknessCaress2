import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import configJson from "../config/config.json" with { type: "json" };
import { projectEngineConfig } from "./config.js";
import { applyMoves, checkVictory, type AppliedTurn } from "./apply.js";
import { previewMove, reachableTiles } from "./reach.js";
import type { Board, GameEngineConfig, Move, Tile, Unit } from "./types.js";

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
    hp: 20,
    maxHp: 20,
    acted: false,
    ...partial,
  };
}

const baseCfg = projectEngineConfig(configJson as Parameters<typeof projectEngineConfig>[0]);

function cfgFromRaw(raw: Parameters<typeof projectEngineConfig>[0]): GameEngineConfig {
  return projectEngineConfig(raw);
}

function attackEvent(events: AppliedTurn["events"]) {
  return events.find(
    (e): e is Extract<AppliedTurn["events"][number], { kind: "attack" }> => e.kind === "attack",
  );
}
function healEvent(events: AppliedTurn["events"]) {
  return events.find(
    (e): e is Extract<AppliedTurn["events"][number], { kind: "heal" }> => e.kind === "heal",
  );
}

describe("applyMoves - counters and combat matrix", () => {
  it("mage-3-no-counter-by-range1, archer-2-mutual, spear-1-mutual, healer never", () => {
    {
      const board = makeBoard(baseCfg.boardSize);
      const mage = u({
        id: "P-mage-1",
        side: "player",
        class: "mage",
        x: 0,
        y: 0,
        hp: 15,
        maxHp: 15,
      });
      const sword = u({
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 3,
        y: 0,
        hp: 20,
        maxHp: 20,
      });
      const res = applyMoves(
        { board, units: [mage, sword] },
        [{ unitId: mage.id, path: [[0, 0]], action: { type: "attack", targetId: sword.id } }],
        "player",
        baseCfg,
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.result.events.some((e) => e.kind === "counter")).toBe(false);
    }
    {
      const board = makeBoard(baseCfg.boardSize);
      const a1 = u({
        id: "P-archer-1",
        side: "player",
        class: "archer",
        x: 0,
        y: 0,
        hp: 16,
        maxHp: 16,
      });
      const a2 = u({
        id: "E-archer-1",
        side: "enemy",
        class: "archer",
        x: 2,
        y: 0,
        hp: 16,
        maxHp: 16,
      });
      const res = applyMoves(
        { board, units: [a1, a2] },
        [{ unitId: a1.id, path: [[0, 0]], action: { type: "attack", targetId: a2.id } }],
        "player",
        baseCfg,
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.result.events.some((e) => e.kind === "counter")).toBe(true);
    }
    {
      const board = makeBoard(baseCfg.boardSize);
      const s1 = u({
        id: "P-spear-1",
        side: "player",
        class: "spear",
        x: 0,
        y: 0,
        hp: 18,
        maxHp: 18,
      });
      const s2 = u({
        id: "E-spear-1",
        side: "enemy",
        class: "spear",
        x: 1,
        y: 0,
        hp: 18,
        maxHp: 18,
      });
      const res = applyMoves(
        { board, units: [s1, s2] },
        [{ unitId: s1.id, path: [[0, 0]], action: { type: "attack", targetId: s2.id } }],
        "player",
        baseCfg,
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.result.events.some((e) => e.kind === "counter")).toBe(true);
    }
    {
      const board = makeBoard(baseCfg.boardSize);
      const s1 = u({
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 0,
        y: 0,
        hp: 20,
        maxHp: 20,
      });
      const h = u({
        id: "E-healer-1",
        side: "enemy",
        class: "healer",
        x: 1,
        y: 0,
        hp: 18,
        maxHp: 18,
      });
      const res = applyMoves(
        { board, units: [s1, h] },
        [{ unitId: s1.id, path: [[0, 0]], action: { type: "attack", targetId: h.id } }],
        "player",
        baseCfg,
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.result.events.some((e) => e.kind === "counter")).toBe(false);
    }
  });

  it("damage floor at 0, heal clamping, death removes unit", () => {
    const board = makeBoard(baseCfg.boardSize);
    const raw = JSON.parse(JSON.stringify(configJson)) as {
      boardSize: number;
      classes: Record<string, Record<string, unknown>>;
    };
    raw.classes.sword.atk = 1;
    raw.classes.axe.def = 10;
    const cfg = projectEngineConfig(raw as Parameters<typeof projectEngineConfig>[0]);
    const weak = u({
      id: "P-sword-1",
      side: "player",
      class: "sword",
      x: 0,
      y: 0,
      hp: 20,
      maxHp: 20,
    });
    const tank = u({ id: "E-axe-1", side: "enemy", class: "axe", x: 1, y: 0, hp: 25, maxHp: 25 });
    const r1 = applyMoves(
      { board, units: [weak, tank] },
      [{ unitId: weak.id, path: [[0, 0]], action: { type: "attack", targetId: tank.id } }],
      "player",
      cfg,
    );
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const atkEv = attackEvent(r1.result.events);
    expect(atkEv?.damage).toBe(0);
    expect(atkEv?.targetHp).toBe(25);

    const healer = u({
      id: "P-healer-1",
      side: "player",
      class: "healer",
      x: 2,
      y: 2,
      hp: 18,
      maxHp: 18,
    });
    const ally = u({
      id: "P-spear-1",
      side: "player",
      class: "spear",
      x: 2,
      y: 3,
      hp: 15,
      maxHp: 18,
    });
    const r2 = applyMoves(
      { board, units: [healer, ally] },
      [{ unitId: healer.id, path: [[2, 2]], action: { type: "heal", targetId: ally.id } }],
      "player",
      baseCfg,
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    const hEv = healEvent(r2.result.events);
    expect(hEv?.healed).toBe(3);
    expect(hEv?.targetHp).toBe(18);

    const killer = u({
      id: "P-axe-1",
      side: "player",
      class: "axe",
      x: 4,
      y: 4,
      hp: 25,
      maxHp: 25,
    });
    const victim = u({
      id: "E-sword-1",
      side: "enemy",
      class: "sword",
      x: 5,
      y: 4,
      hp: 1,
      maxHp: 20,
    });
    const r3 = applyMoves(
      { board, units: [killer, victim] },
      [{ unitId: killer.id, path: [[4, 4]], action: { type: "attack", targetId: victim.id } }],
      "player",
      baseCfg,
    );
    expect(r3.ok).toBe(true);
    if (!r3.ok) return;
    expect(r3.result.events.some((e) => e.kind === "died" && e.unitId === victim.id)).toBe(true);
    expect(r3.result.state.units.find((x) => x.id === victim.id)).toBeUndefined();
  });

  it("healer cannot attack", () => {
    const board = makeBoard(baseCfg.boardSize);
    const healer = u({
      id: "P-healer-1",
      side: "player",
      class: "healer",
      x: 0,
      y: 0,
      hp: 18,
      maxHp: 18,
    });
    const enemy = u({
      id: "E-sword-1",
      side: "enemy",
      class: "sword",
      x: 1,
      y: 0,
      hp: 20,
      maxHp: 20,
    });
    const res = applyMoves(
      { board, units: [healer, enemy] },
      [
        {
          unitId: healer.id,
          path: [[0, 0]],
          action: { type: "attack", targetId: enemy.id },
        } as Move,
      ],
      "player",
      baseCfg,
    );
    expect(res).toEqual({ ok: false, error: "healer cannot attack" });
  });

  it("missing-targetId rejection", () => {
    const board = makeBoard(baseCfg.boardSize);
    const sword = u({ id: "P-sword-1", side: "player", class: "sword", x: 0, y: 0 });
    const healer = u({
      id: "P-healer-1",
      side: "player",
      class: "healer",
      x: 2,
      y: 2,
      hp: 18,
      maxHp: 18,
    });
    const enemy = u({ id: "E-sword-1", side: "enemy", class: "sword", x: 1, y: 0 });
    expect(
      applyMoves(
        { board, units: [sword, enemy] },
        [
          {
            unitId: sword.id,
            path: [[0, 0]],
            action: { type: "attack" } as unknown as Move["action"],
          } as Move,
        ],
        "player",
        baseCfg,
      ),
    ).toEqual({ ok: false, error: "attack requires a target" });
    expect(
      applyMoves(
        { board, units: [healer] },
        [
          {
            unitId: healer.id,
            path: [[2, 2]],
            action: { type: "heal" } as unknown as Move["action"],
          } as Move,
        ],
        "player",
        baseCfg,
      ),
    ).toEqual({ ok: false, error: "heal requires a target" });
  });

  it("acted semantics, duplicate rejection, evolving landing, atomicity, sequential resolution", () => {
    const board = makeBoard(baseCfg.boardSize);
    const a = u({ id: "P-sword-1", side: "player", class: "sword", x: 0, y: 0 });
    const b = u({ id: "P-sword-2", side: "player", class: "sword", x: 0, y: 1, acted: true });
    expect(
      applyMoves(
        { board, units: [a] },
        [
          { unitId: a.id, path: [[0, 0]], action: { type: "wait" } },
          { unitId: a.id, path: [[0, 0]], action: { type: "wait" } },
        ],
        "player",
        baseCfg,
      ),
    ).toEqual({ ok: false, error: `${a.id} appears twice` });
    expect(
      applyMoves(
        { board, units: [b] },
        [{ unitId: b.id, path: [[0, 1]], action: { type: "wait" } }],
        "player",
        baseCfg,
      ),
    ).toEqual({ ok: false, error: `${b.id} already acted this turn` });

    {
      const u1 = u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 });
      const u2 = u({ id: "P-axe-1", side: "player", class: "axe", x: 2, y: 1 });
      const moves: Move[] = [
        {
          unitId: u1.id,
          path: [
            [1, 1],
            [1, 2],
          ],
          action: { type: "wait" },
        },
        {
          unitId: u2.id,
          path: [
            [2, 1],
            [1, 1],
          ],
          action: { type: "wait" },
        },
      ];
      const res = applyMoves(
        { board: makeBoard(baseCfg.boardSize), units: [u1, u2] },
        moves,
        "player",
        baseCfg,
      );
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.result.state.units.find((x) => x.id === u1.id)).toMatchObject({
          x: 1,
          y: 2,
          acted: true,
        });
        expect(res.result.state.units.find((x) => x.id === u2.id)).toMatchObject({
          x: 1,
          y: 1,
          acted: true,
        });
      }
    }

    {
      const u1 = u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 });
      const u2 = u({ id: "P-axe-1", side: "player", class: "axe", x: 2, y: 1 });
      const moves: Move[] = [
        {
          unitId: u2.id,
          path: [
            [2, 1],
            [3, 1],
          ],
          action: { type: "wait" },
        },
        {
          unitId: u1.id,
          path: [
            [1, 1],
            [2, 1],
          ],
          action: { type: "wait" },
        },
      ];
      const res = applyMoves(
        { board: makeBoard(baseCfg.boardSize), units: [u1, u2] },
        moves,
        "player",
        baseCfg,
      );
      expect(res.ok).toBe(true);
    }

    {
      const u1 = u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 });
      const u2 = u({ id: "P-axe-1", side: "player", class: "axe", x: 3, y: 1 });
      const moves: Move[] = [
        {
          unitId: u1.id,
          path: [
            [1, 1],
            [2, 1],
          ],
          action: { type: "wait" },
        },
        {
          unitId: u2.id,
          path: [
            [3, 1],
            [2, 1],
          ],
          action: { type: "wait" },
        },
      ];
      const res = applyMoves(
        { board: makeBoard(baseCfg.boardSize), units: [u1, u2] },
        moves,
        "player",
        baseCfg,
      );
      expect(res).toEqual({ ok: false, error: "tile (2,1) is claimed by two moves" });
    }

    {
      const u1 = u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 });
      const u2 = u({ id: "P-axe-1", side: "player", class: "axe", x: 2, y: 1 });
      const moves: Move[] = [
        {
          unitId: u1.id,
          path: [
            [1, 1],
            [2, 1],
          ],
          action: { type: "wait" },
        },
      ];
      const res = applyMoves(
        { board: makeBoard(baseCfg.boardSize), units: [u1, u2] },
        moves,
        "player",
        baseCfg,
      );
      expect(res).toEqual({
        ok: false,
        error: "tile (2,1) is occupied in the current position of the turn chain",
      });
    }

    {
      const u1 = u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 });
      const u2 = u({ id: "P-axe-1", side: "player", class: "axe", x: 3, y: 1 });
      const state = { board: makeBoard(baseCfg.boardSize), units: [u1, u2] };
      const before = JSON.stringify(state);
      const moves: Move[] = [
        {
          unitId: u1.id,
          path: [
            [1, 1],
            [2, 1],
          ],
          action: { type: "wait" },
        },
        { unitId: "nope", path: [[3, 1]], action: { type: "wait" } },
      ];
      const res = applyMoves(state, moves, "player", baseCfg);
      expect(res.ok).toBe(false);
      expect(JSON.stringify(state)).toBe(before);
    }

    {
      const attacker = u({
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 0,
        y: 0,
        hp: 5,
        maxHp: 20,
      });
      const defender = u({
        id: "E-axe-1",
        side: "enemy",
        class: "axe",
        x: 1,
        y: 0,
        hp: 25,
        maxHp: 25,
      });
      const target = u({
        id: "E-sword-1",
        side: "enemy",
        class: "sword",
        x: 1,
        y: 1,
        hp: 20,
        maxHp: 20,
      });
      const moves2: Move[] = [
        { unitId: attacker.id, path: [[0, 0]], action: { type: "attack", targetId: defender.id } },
        {
          unitId: attacker.id,
          path: [
            [0, 0],
            [0, 1],
          ],
          action: { type: "wait" },
        },
      ];
      const state = { board: makeBoard(baseCfg.boardSize), units: [attacker, defender, target] };
      const res = applyMoves(state, moves2, "player", baseCfg);
      expect(res.ok).toBe(false);
      expect(res.ok ? null : res.error).toBe(`unknown unit ${attacker.id}`);
      expect(state.units.find((x) => x.id === attacker.id)?.hp).toBe(5);
    }
  });

  it("victory check both directions", () => {
    const player = u({ id: "P-sword-1", side: "player", class: "sword", x: 0, y: 0 });
    const enemy = u({ id: "E-sword-1", side: "enemy", class: "sword", x: 1, y: 0 });
    expect(checkVictory([player, enemy])).toBeNull();
    expect(checkVictory([player])).toBe("player");
    expect(checkVictory([enemy])).toBe("enemy");
  });
});

describe("mutated config proves no hardcoded stats", () => {
  it("reruns with mutated config numbers in a temp file and still behaves per cfg", () => {
    const raw = JSON.parse(JSON.stringify(configJson)) as {
      boardSize: number;
      classes: Record<string, Record<string, unknown>>;
    };
    raw.boardSize = 8;
    raw.classes.sword.atk = 99;
    raw.classes.sword.def = 1;
    raw.classes.sword.mov = 1;
    raw.classes.sword.range = [2];
    raw.classes.healer.healAmount = 2;
    const tmp = path.join(os.tmpdir(), `dc2-engine-apply-${Date.now()}-mut.json`);
    fs.writeFileSync(tmp, JSON.stringify(raw), "utf8");
    try {
      const loaded = JSON.parse(fs.readFileSync(tmp, "utf8")) as Parameters<
        typeof projectEngineConfig
      >[0];
      const cfg = cfgFromRaw(loaded);
      const board = makeBoard(cfg.boardSize);
      const reach = reachableTiles(
        board,
        [u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 })],
        u({ id: "P-sword-1", side: "player", class: "sword", x: 1, y: 1 }),
        cfg,
      );
      expect(reach.has("2,1")).toBe(true);
      expect(reach.has("3,1")).toBe(false);

      const sword = u({
        id: "P-sword-1",
        side: "player",
        class: "sword",
        x: 0,
        y: 0,
        hp: 20,
        maxHp: 20,
      });
      const enemyNear = u({
        id: "E-spear-1",
        side: "enemy",
        class: "spear",
        x: 1,
        y: 0,
        hp: 18,
        maxHp: 18,
      });
      const enemyFar = u({
        id: "E-spear-2",
        side: "enemy",
        class: "spear",
        x: 2,
        y: 0,
        hp: 18,
        maxHp: 18,
      });
      const bad = applyMoves(
        { board, units: [sword, enemyNear] },
        [{ unitId: sword.id, path: [[0, 0]], action: { type: "attack", targetId: enemyNear.id } }],
        "player",
        cfg,
      );
      expect(bad.ok).toBe(false);
      const ok = applyMoves(
        { board, units: [u({ ...sword }), u({ ...enemyFar })] },
        [{ unitId: sword.id, path: [[0, 0]], action: { type: "attack", targetId: enemyFar.id } }],
        "player",
        cfg,
      );
      expect(ok.ok).toBe(true);
      if (ok.ok) {
        const atkEv = attackEvent(ok.result.events);
        expect(atkEv?.damage).toBe(Math.max(0, cfg.classes.sword.atk - cfg.classes.spear.def));
      }

      const healer = u({
        id: "P-healer-1",
        side: "player",
        class: "healer",
        x: 4,
        y: 4,
        hp: 18,
        maxHp: 18,
      });
      const ally = u({
        id: "P-axe-1",
        side: "player",
        class: "axe",
        x: 4,
        y: 5,
        hp: 10,
        maxHp: 25,
      });
      const hr = applyMoves(
        { board, units: [healer, ally] },
        [{ unitId: healer.id, path: [[4, 4]], action: { type: "heal", targetId: ally.id } }],
        "player",
        cfg,
      );
      expect(hr.ok).toBe(true);
      if (hr.ok) {
        const hev = healEvent(hr.result.events);
        expect(hev?.healed).toBe(2);
      }
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});

describe("preview consistency", () => {
  it("preview matches reachable/attack and heal tiles from engine", () => {
    const board = makeBoard(baseCfg.boardSize);
    const mage = u({
      id: "P-mage-1",
      side: "player",
      class: "mage",
      x: 3,
      y: 3,
      hp: 15,
      maxHp: 15,
    });
    const enemy = u({
      id: "E-sword-1",
      side: "enemy",
      class: "sword",
      x: 3,
      y: 5,
      hp: 20,
      maxHp: 20,
    });
    const prev = previewMove(board, [mage, enemy], mage, baseCfg);
    const reach = reachableTiles(board, [mage, enemy], mage, baseCfg);
    expect(new Set(prev.moveTiles.map(([x, y]) => `${x},${y}`))).toEqual(reach);
    expect(prev.attackTiles.some(([x, y]) => x === 3 && y === 5)).toBe(true);
  });
});
