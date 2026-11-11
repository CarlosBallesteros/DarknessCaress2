import { describe, expect, it } from "vitest";
import { applyMoves, checkVictory, type AppliedTurn } from "./apply";
import {
  SIZE,
  type Board,
  type ClassKey,
  type GameEngineConfig,
  type Move,
  type Side,
  type Tile,
  type Unit,
} from "./types";
import { engineConfig } from "../config/engine";

// Parametrized with the REAL config values (docs/02): every expected damage,
// hp, range and heal amount derives from engineConfig, so rebalancing
// config.json re-validates the engine by rerunning the suite.
const CFG = engineConfig;
const HEAL = CFG.classes.healer.healAmount ?? 0;

let nextId = 0;
function unit(
  classKey: ClassKey,
  side: Side,
  x: number,
  y: number,
  overrides: Partial<Unit> = {},
): Unit {
  const cls = CFG.classes[classKey];
  return {
    id: `u${nextId++}`,
    side,
    class: classKey,
    x,
    y,
    hp: cls.hp,
    maxHp: cls.hp,
    acted: false,
    ...overrides,
  };
}

function board(entries: Array<[x: number, y: number, tile: Tile]> = []): Board {
  const tiles: Tile[][] = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => "plain" as Tile),
  );
  for (const [x, y, tile] of entries) tiles[y][x] = tile;
  return { tiles };
}

function move(unitId: string, path: Array<[number, number]>, action: Move["action"]): Move {
  return { unitId, path, action };
}

type Ev = AppliedTurn["events"][number];
function ofKind<K extends Ev["kind"]>(events: Ev[], kind: K): Array<Extract<Ev, { kind: K }>> {
  return events.filter((e): e is Extract<Ev, { kind: K }> => e.kind === kind);
}

const WAIT_IN_PLACE = (u: Unit): Move => move(u.id, [[u.x, u.y]], { type: "wait" });

describe("applyMoves — attack & counter matrix", () => {
  it("mage strikes from 3 tiles; a range-1 defender cannot counter", () => {
    const mage = unit("mage", "player", 5, 7);
    const enemy = unit("sword", "enemy", 5, 10);
    const result = applyMoves(
      { board: board(), units: [mage, enemy] },
      [move(mage.id, [[5, 7]], { type: "attack", targetId: enemy.id })],
      "player",
      CFG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expectedDamage = CFG.classes.mage.atk - CFG.classes.sword.def;
    const attacks = ofKind(result.result.events, "attack");
    expect(attacks).toHaveLength(1);
    expect(attacks[0]).toMatchObject({
      attackerId: mage.id,
      targetId: enemy.id,
      damage: expectedDamage,
      targetHp: CFG.classes.sword.hp - expectedDamage,
    });
    expect(ofKind(result.result.events, "counter")).toHaveLength(0); // sword range [1], 3 tiles away
  });

  it("adjacent melee is mutual: attacker hits, then the defender counters", () => {
    const sword = unit("sword", "player", 7, 7);
    const mage = unit("mage", "enemy", 7, 8);
    const result = applyMoves(
      { board: board(), units: [sword, mage] },
      [move(sword.id, [[7, 7]], { type: "attack", targetId: mage.id })],
      "player",
      CFG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attackDamage = CFG.classes.sword.atk - CFG.classes.mage.def;
    const counterDamage = CFG.classes.mage.atk - CFG.classes.sword.def;
    expect(ofKind(result.result.events, "attack")).toHaveLength(1);
    // targetId = the counterer; targetHp = the original attacker's hp after it
    expect(ofKind(result.result.events, "counter")).toEqual([
      {
        kind: "counter",
        attackerId: sword.id,
        targetId: mage.id,
        damage: counterDamage,
        targetHp: CFG.classes.sword.hp - counterDamage,
      },
    ]);
    expect(result.result.state.units.find((u) => u.id === mage.id)?.hp).toBe(
      CFG.classes.mage.hp - attackDamage,
    );
  });

  it("archers trade at exactly 2 tiles", () => {
    const a = unit("archer", "player", 3, 3);
    const b = unit("archer", "enemy", 3, 5);
    const result = applyMoves(
      { board: board(), units: [a, b] },
      [move(a.id, [[3, 3]], { type: "attack", targetId: b.id })],
      "player",
      CFG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const damage = CFG.classes.archer.atk - CFG.classes.archer.def;
    expect(ofKind(result.result.events, "attack")[0]?.damage).toBe(damage);
    expect(ofKind(result.result.events, "counter")[0]?.damage).toBe(damage); // mutual
  });

  it("spearmen trade adjacent", () => {
    const a = unit("spear", "player", 9, 3);
    const b = unit("spear", "enemy", 9, 4);
    const result = applyMoves(
      { board: board(), units: [a, b] },
      [move(a.id, [[9, 3]], { type: "attack", targetId: b.id })],
      "player",
      CFG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const damage = CFG.classes.spear.atk - CFG.classes.spear.def;
    expect(ofKind(result.result.events, "counter")).toHaveLength(1); // mutual
    expect(ofKind(result.result.events, "attack")[0]?.damage).toBe(damage);
  });

  it("a healer never counters", () => {
    const axe = unit("axe", "player", 11, 3);
    const healer = unit("healer", "enemy", 11, 4);
    const result = applyMoves(
      { board: board(), units: [axe, healer] },
      [move(axe.id, [[11, 3]], { type: "attack", targetId: healer.id })],
      "player",
      CFG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ofKind(result.result.events, "attack")).toHaveLength(1);
    expect(ofKind(result.result.events, "counter")).toHaveLength(0);
    expect(result.result.state.units.find((u) => u.id === healer.id)?.hp).toBe(
      CFG.classes.healer.hp - (CFG.classes.axe.atk - CFG.classes.healer.def),
    );
  });

  it("rejects out-of-range attacks with the catalogue message (range is a LIST)", () => {
    const archer = unit("archer", "player", 3, 3);
    const oneAway = unit("sword", "enemy", 3, 4);
    const threeAway = unit("sword", "enemy", 3, 6);
    const tooClose = applyMoves(
      { board: board(), units: [archer, oneAway] },
      [move(archer.id, [[3, 3]], { type: "attack", targetId: oneAway.id })],
      "player",
      CFG,
    );
    expect(tooClose).toEqual({ ok: false, error: "archer cannot attack a unit at 1 tiles" });
    const tooFar = applyMoves(
      { board: board(), units: [archer, threeAway] },
      [move(archer.id, [[3, 3]], { type: "attack", targetId: threeAway.id })],
      "player",
      CFG,
    );
    expect(tooFar).toEqual({ ok: false, error: "archer cannot attack a unit at 3 tiles" });
    const sword = unit("sword", "player", 7, 7);
    const axeEnemy = unit("axe", "enemy", 7, 9);
    const swordTooFar = applyMoves(
      { board: board(), units: [sword, axeEnemy] },
      [move(sword.id, [[7, 7]], { type: "attack", targetId: axeEnemy.id })],
      "player",
      CFG,
    );
    expect(swordTooFar).toEqual({ ok: false, error: "sword cannot attack a unit at 2 tiles" });
  });

  it("damage floors at 0 (def ≥ atk) — no counter from a zero-atk defender", () => {
    const floorCfg: GameEngineConfig = {
      boardSize: CFG.boardSize,
      classes: {
        ...CFG.classes,
        sword: { ...CFG.classes.sword, atk: 0, def: CFG.classes.axe.atk + 1 },
      },
    };
    const axe = unit("axe", "player", 7, 7);
    const sword = unit("sword", "enemy", 7, 8);
    const result = applyMoves(
      { board: board(), units: [axe, sword] },
      [move(axe.id, [[7, 7]], { type: "attack", targetId: sword.id })],
      "player",
      floorCfg,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ofKind(result.result.events, "attack")[0]?.damage).toBe(
      Math.max(0, floorCfg.classes.axe.atk - floorCfg.classes.sword.def),
    );
    expect(ofKind(result.result.events, "counter")).toHaveLength(0);
    expect(result.result.state.units.find((u) => u.id === sword.id)?.hp).toBe(sword.hp);
  });
});

describe("applyMoves — heal", () => {
  it("clamps to the missing hp when the wound is smaller than healAmount", () => {
    const healer = unit("healer", "player", 5, 7);
    const wounded = unit("archer", "player", 5, 8, { hp: CFG.classes.archer.hp - 3 });
    const result = applyMoves(
      { board: board(), units: [healer, wounded] },
      [move(healer.id, [[5, 7]], { type: "heal", targetId: wounded.id })],
      "player",
      CFG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ofKind(result.result.events, "heal")).toEqual([
      {
        kind: "heal",
        healerId: healer.id,
        targetId: wounded.id,
        healed: 3,
        targetHp: CFG.classes.archer.hp,
      },
    ]);
  });

  it("clamps to healAmount when the wound is deeper", () => {
    const healer = unit("healer", "player", 5, 7);
    const wounded = unit("sword", "player", 6, 7, { hp: CFG.classes.sword.hp - 10 });
    const result = applyMoves(
      { board: board(), units: [healer, wounded] },
      [move(healer.id, [[5, 7]], { type: "heal", targetId: wounded.id })],
      "player",
      CFG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ofKind(result.result.events, "heal")[0]?.healed).toBe(HEAL);
    expect(result.result.state.units.find((u) => u.id === wounded.id)?.hp).toBe(
      CFG.classes.sword.hp - 10 + HEAL,
    );
  });

  it("rejects full-hp and non-adjacent targets", () => {
    const healer = unit("healer", "player", 5, 7);
    const fullHp = unit("axe", "player", 5, 8);
    const farWounded = unit("sword", "player", 5, 9, { hp: CFG.classes.sword.hp - 10 });
    const full = applyMoves(
      { board: board(), units: [healer, fullHp] },
      [move(healer.id, [[5, 7]], { type: "heal", targetId: fullHp.id })],
      "player",
      CFG,
    );
    expect(full).toEqual({ ok: false, error: "heal target must be adjacent and wounded" });
    const far = applyMoves(
      { board: board(), units: [healer, farWounded] },
      [move(healer.id, [[5, 7]], { type: "heal", targetId: farWounded.id })],
      "player",
      CFG,
    );
    expect(far).toEqual({ ok: false, error: "heal target must be adjacent and wounded" });
  });

  it("a non-healer cannot heal", () => {
    const sword = unit("sword", "player", 5, 7);
    const wounded = unit("axe", "player", 5, 8, { hp: CFG.classes.axe.hp - 3 });
    const result = applyMoves(
      { board: board(), units: [sword, wounded] },
      [move(sword.id, [[5, 7]], { type: "heal", targetId: wounded.id })],
      "player",
      CFG,
    );
    expect(result).toEqual({ ok: false, error: "sword cannot heal" });
  });
});

describe("applyMoves — deaths", () => {
  it("a lethal attack removes the target", () => {
    const axe = unit("axe", "player", 7, 3);
    const archer = unit("archer", "enemy", 7, 4, { hp: 4 });
    const result = applyMoves(
      { board: board(), units: [axe, archer] },
      [move(axe.id, [[7, 3]], { type: "attack", targetId: archer.id })],
      "player",
      CFG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const damage = CFG.classes.axe.atk - CFG.classes.archer.def;
    expect(ofKind(result.result.events, "died")).toEqual([{ kind: "died", unitId: archer.id }]);
    expect(result.result.state.units.find((u) => u.id === archer.id)).toBeUndefined();
    expect(ofKind(result.result.events, "attack")[0]?.targetHp).toBe(4 - damage);
  });

  it("a counter can kill the attacker", () => {
    const sword = unit("sword", "player", 7, 7, { hp: 4 });
    const axe = unit("axe", "enemy", 7, 8);
    const result = applyMoves(
      { board: board(), units: [sword, axe] },
      [move(sword.id, [[7, 7]], { type: "attack", targetId: axe.id })],
      "player",
      CFG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.events.map((e) => e.kind)).toEqual(["attack", "counter", "died"]);
    expect(ofKind(result.result.events, "died")).toEqual([{ kind: "died", unitId: sword.id }]);
    expect(result.result.state.units.find((u) => u.id === sword.id)).toBeUndefined();
    expect(result.result.state.units.find((u) => u.id === axe.id)?.hp).toBe(
      CFG.classes.axe.hp - (CFG.classes.sword.atk - CFG.classes.axe.def),
    );
  });

  it("damage accumulates sequentially, never simultaneously", () => {
    const archer = unit("archer", "player", 3, 3);
    const axe = unit("axe", "player", 3, 6);
    const enemy = unit("archer", "enemy", 3, 5, { hp: 8 });
    const result = applyMoves(
      { board: board(), units: [archer, axe, enemy] },
      [
        move(archer.id, [[3, 3]], { type: "attack", targetId: enemy.id }),
        move(axe.id, [[3, 6]], { type: "attack", targetId: enemy.id }),
      ],
      "player",
      CFG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const archerDamage = CFG.classes.archer.atk - CFG.classes.archer.def;
    const axeDamage = CFG.classes.axe.atk - CFG.classes.archer.def;
    // first hit 8→4, the counter answers, only then the second hit resolves
    expect(ofKind(result.result.events, "attack").map((e) => e.targetHp)).toEqual([
      8 - archerDamage,
      8 - archerDamage - axeDamage,
    ]);
    expect(ofKind(result.result.events, "counter")).toHaveLength(1); // only after the first hit
    expect(ofKind(result.result.events, "died")).toEqual([{ kind: "died", unitId: enemy.id }]);
  });
});

describe("applyMoves — acted & bundle-entry validation", () => {
  it("marks every entry's unit acted (wait counts); omitted units stay unacted", () => {
    const sword = unit("sword", "player", 7, 7);
    const axe = unit("axe", "player", 8, 8);
    const spear = unit("spear", "player", 9, 9);
    const result = applyMoves(
      { board: board(), units: [sword, axe, spear] },
      [
        WAIT_IN_PLACE(sword),
        move(
          axe.id,
          [
            [8, 8],
            [8, 9],
          ],
          { type: "wait" },
        ),
      ],
      "player",
      CFG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const units = result.result.state.units;
    expect(units.find((u) => u.id === sword.id)?.acted).toBe(true);
    expect(units.find((u) => u.id === axe.id)?.acted).toBe(true);
    expect(units.find((u) => u.id === spear.id)?.acted).toBe(false);
    expect(units.find((u) => u.id === axe.id)).toMatchObject({ x: 8, y: 9 });
    expect(ofKind(result.result.events, "moved")).toEqual([
      { kind: "moved", unitId: axe.id, from: [8, 8], to: [8, 9] },
    ]);
    expect(ofKind(result.result.events, "wait")).toHaveLength(2);
  });

  it("rejects unknown units, wrong-side units and already-acted units", () => {
    const sword = unit("sword", "player", 7, 7);
    const enemy = unit("axe", "enemy", 8, 8);
    expect(
      applyMoves(
        { board: board(), units: [sword] },
        [move("ghost", [[7, 7]], { type: "wait" })],
        "player",
        CFG,
      ),
    ).toEqual({ ok: false, error: "unknown unit ghost" });
    expect(
      applyMoves({ board: board(), units: [sword, enemy] }, [WAIT_IN_PLACE(enemy)], "player", CFG),
    ).toEqual({ ok: false, error: `${enemy.id} belongs to the other army` });
    const acted = unit("spear", "player", 9, 9, { acted: true });
    expect(
      applyMoves({ board: board(), units: [acted] }, [WAIT_IN_PLACE(acted)], "player", CFG),
    ).toEqual({ ok: false, error: `${acted.id} already acted this turn` });
  });

  it("rejects a duplicate bundle entry", () => {
    const sword = unit("sword", "player", 7, 7);
    const result = applyMoves(
      { board: board(), units: [sword] },
      [WAIT_IN_PLACE(sword), WAIT_IN_PLACE(sword)],
      "player",
      CFG,
    );
    expect(result).toEqual({ ok: false, error: `${sword.id} appears twice` });
  });

  it("rejects missing targetIds and unknown action types", () => {
    const mage = unit("mage", "player", 5, 7);
    const sword = unit("sword", "enemy", 5, 8);
    const noTarget = {
      unitId: mage.id,
      path: [[5, 7]],
      action: { type: "attack" },
    } as unknown as Move;
    expect(applyMoves({ board: board(), units: [mage, sword] }, [noTarget], "player", CFG)).toEqual(
      { ok: false, error: "attack requires a target" },
    );

    const healer = unit("healer", "player", 5, 7);
    const wounded = unit("axe", "player", 5, 8, { hp: CFG.classes.axe.hp - 3 });
    const noHealTarget = {
      unitId: healer.id,
      path: [[5, 7]],
      action: { type: "heal" },
    } as unknown as Move;
    expect(
      applyMoves({ board: board(), units: [healer, wounded] }, [noHealTarget], "player", CFG),
    ).toEqual({ ok: false, error: "heal requires a target" });

    const dance = {
      unitId: mage.id,
      path: [[5, 7]],
      action: { type: "dance" },
    } as unknown as Move;
    expect(applyMoves({ board: board(), units: [mage, sword] }, [dance], "player", CFG)).toEqual({
      ok: false,
      error: 'unknown action "dance"',
    });
  });

  it("rejects invalid attack targets: unknown id, own side, dead earlier in the bundle", () => {
    const sword = unit("sword", "player", 7, 7);
    const axe = unit("axe", "player", 8, 8);
    const axeEnemy = unit("axe", "enemy", 13, 8);
    const archer = unit("archer", "enemy", 7, 4, { hp: 4 });
    const killer = unit("axe", "player", 7, 3);
    expect(
      applyMoves(
        { board: board(), units: [sword, axeEnemy] },
        [move(sword.id, [[7, 7]], { type: "attack", targetId: "ghost" })],
        "player",
        CFG,
      ),
    ).toEqual({ ok: false, error: "unknown unit ghost" });
    expect(
      applyMoves(
        { board: board(), units: [sword, axe] },
        [move(sword.id, [[7, 7]], { type: "attack", targetId: axe.id })],
        "player",
        CFG,
      ),
    ).toEqual({ ok: false, error: `${axe.id} is not a valid attack target` });
    const deadTarget = applyMoves(
      { board: board(), units: [killer, sword, archer] },
      [
        move(killer.id, [[7, 3]], { type: "attack", targetId: archer.id }),
        move(sword.id, [[7, 7]], { type: "attack", targetId: archer.id }),
      ],
      "player",
      CFG,
    );
    expect(deadTarget).toEqual({ ok: false, error: `${archer.id} is not a valid attack target` });
  });

  it("a healer cannot attack at all", () => {
    const healer = unit("healer", "player", 5, 7);
    const enemy = unit("sword", "enemy", 5, 8);
    const result = applyMoves(
      { board: board(), units: [healer, enemy] },
      [move(healer.id, [[5, 7]], { type: "attack", targetId: enemy.id })],
      "player",
      CFG,
    );
    expect(result).toEqual({ ok: false, error: "healer cannot attack" });
  });
});

describe("applyMoves — evolving landing rule", () => {
  it("chain-follow: a later entry lands on a tile an earlier entry vacated", () => {
    const a = unit("sword", "player", 5, 5);
    const b = unit("sword", "player", 6, 5);
    const result = applyMoves(
      { board: board(), units: [a, b] },
      [
        move(
          b.id,
          [
            [6, 5],
            [7, 5],
          ],
          { type: "wait" },
        ),
        move(
          a.id,
          [
            [5, 5],
            [6, 5],
          ],
          { type: "wait" },
        ),
      ],
      "player",
      CFG,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.state.units.find((u) => u.id === a.id)).toMatchObject({ x: 6, y: 5 });
    expect(result.result.state.units.find((u) => u.id === b.id)).toMatchObject({ x: 7, y: 5 });
  });

  it("two entries claiming the same tile reject", () => {
    const a = unit("sword", "player", 4, 5);
    const b = unit("sword", "player", 8, 5);
    const result = applyMoves(
      { board: board(), units: [a, b] },
      [
        move(
          a.id,
          [
            [4, 5],
            [5, 5],
            [6, 5],
          ],
          { type: "wait" },
        ),
        move(
          b.id,
          [
            [8, 5],
            [7, 5],
            [6, 5],
          ],
          { type: "wait" },
        ),
      ],
      "player",
      CFG,
    );
    expect(result).toEqual({ ok: false, error: "tile (6,5) is claimed by two moves" });
  });

  it("landing on a tile still occupied in the chain rejects; swapping the order works", () => {
    const a = unit("sword", "player", 5, 5);
    const b = unit("sword", "player", 6, 5);
    const dirtySwap = applyMoves(
      { board: board(), units: [a, b] },
      [
        move(
          a.id,
          [
            [5, 5],
            [6, 5],
          ],
          { type: "wait" },
        ),
        move(
          b.id,
          [
            [6, 5],
            [7, 5],
          ],
          { type: "wait" },
        ),
      ],
      "player",
      CFG,
    );
    expect(dirtySwap).toEqual({
      ok: false,
      error: "tile (6,5) is occupied in the current position of the turn chain",
    });
    const orderedSwap = applyMoves(
      { board: board(), units: [a, b] },
      [
        move(
          b.id,
          [
            [6, 5],
            [7, 5],
          ],
          { type: "wait" },
        ),
        move(
          a.id,
          [
            [5, 5],
            [6, 5],
          ],
          { type: "wait" },
        ),
      ],
      "player",
      CFG,
    );
    expect(orderedSwap.ok).toBe(true);
  });

  it("a wait entry holds its tile: another entry may not land there", () => {
    const holder = unit("sword", "player", 6, 5);
    const mover = unit("sword", "player", 4, 5);
    const result = applyMoves(
      { board: board(), units: [holder, mover] },
      [
        WAIT_IN_PLACE(holder),
        move(
          mover.id,
          [
            [4, 5],
            [5, 5],
            [6, 5],
          ],
          { type: "wait" },
        ),
      ],
      "player",
      CFG,
    );
    expect(result).toEqual({ ok: false, error: "tile (6,5) is claimed by two moves" });
  });
});

describe("applyMoves — whole-bundle atomicity", () => {
  it("one bad move rejects the bundle and leaves the input state untouched", () => {
    const sword = unit("sword", "player", 7, 7);
    const axe = unit("axe", "player", 8, 8);
    const enemy = unit("axe", "enemy", 13, 8);
    const state = { board: board(), units: [sword, axe, enemy] };
    const snapshot = structuredClone(state);
    const result = applyMoves(
      state,
      [
        move(
          sword.id,
          [
            [7, 7],
            [7, 8],
          ],
          { type: "wait" },
        ),
        move(axe.id, [[8, 8]], { type: "attack", targetId: enemy.id }),
      ],
      "player",
      CFG,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe(`axe cannot attack a unit at 5 tiles`);
    expect(state).toEqual(snapshot); // positions, hp and acted flags all untouched
  });
});

describe("checkVictory", () => {
  it("player wins when the enemy army is wiped, enemy wins on the mirror, null otherwise", () => {
    const sword = unit("sword", "player", 7, 7);
    expect(checkVictory([sword])).toBe("player");
    const axe = unit("axe", "enemy", 8, 8);
    expect(checkVictory([axe])).toBe("enemy");
    expect(checkVictory([sword, axe])).toBeNull();
  });
});
