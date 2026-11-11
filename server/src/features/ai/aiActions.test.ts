// The events → AiAction DTO mapping (docs/06 shared DTOs): counter flipped
// into the DTO shape, deaths flagged on the target, heal amount as damage,
// wait → outcome null.
import { describe, expect, it } from "vitest";
import { engineConfig } from "../../config/engine";
import { applyMoves } from "../../game/apply";
import type { Board, ClassKey, Move, Side, Tile, Unit } from "../../game/types";
import { toAiActions } from "./aiActions";

function plainBoard(): Board {
  const size = engineConfig.boardSize;
  return { tiles: Array.from({ length: size }, () => Array<Tile>(size).fill("plain")) };
}

function unit(id: string, cls: ClassKey, side: Side, x: number, y: number, hp?: number): Unit {
  const maxHp = engineConfig.classes[cls].hp;
  return { id, side, class: cls, x, y, hp: hp ?? maxHp, maxHp, acted: false };
}

describe("toAiActions", () => {
  it("maps attack + counter + heal + wait in execution order", () => {
    const units = [
      unit("E-sword-1", "sword", "enemy", 5, 5), // atk 7 def 5
      unit("P-sword-1", "sword", "player", 6, 5), // atk 7 def 5
      unit("E-healer-1", "healer", "enemy", 5, 6),
      unit("E-sword-2", "sword", "enemy", 6, 6, 10), // wounded heal target
    ];
    const moves: Move[] = [
      { unitId: "E-sword-1", path: [[5, 5]], action: { type: "attack", targetId: "P-sword-1" } },
      { unitId: "E-healer-1", path: [[5, 6]], action: { type: "heal", targetId: "E-sword-2" } },
      { unitId: "E-sword-2", path: [[6, 6]], action: { type: "wait" } },
    ];
    const applied = applyMoves({ board: plainBoard(), units }, moves, "enemy", engineConfig);
    if (!applied.ok) throw new Error(applied.error);

    const actions = toAiActions(moves, applied.result.events);
    expect(actions).toHaveLength(3);
    // attack: damage 7−5=2; the defender counters 7−5=2 → counter flipped:
    // damage to counter.damage, attackerHp = the attacker's hp AFTER it.
    expect(actions[0]).toEqual({
      unitId: "E-sword-1",
      path: [[5, 5]],
      action: { type: "attack", targetId: "P-sword-1" },
      outcome: {
        targetId: "P-sword-1",
        damage: 2,
        targetHp: 18,
        targetDied: false,
        counter: { damage: 2, attackerHp: 18 },
      },
    });
    // heal: the amount healed rides in `damage` (docs/06 DTO note).
    expect(actions[1]).toEqual({
      unitId: "E-healer-1",
      path: [[5, 6]],
      action: { type: "heal", targetId: "E-sword-2" },
      outcome: {
        targetId: "E-sword-2",
        damage: 8,
        targetHp: 18,
        targetDied: false,
        counter: null,
      },
    });
    expect(actions[2]).toEqual({
      unitId: "E-sword-2",
      path: [[6, 6]],
      action: { type: "wait" },
      outcome: null,
    });
  });

  it("flags the TARGET's death; a counter-killed attacker is not the target", () => {
    const units = [
      unit("E-axe-1", "axe", "enemy", 5, 5, 4), // atk 10 def 3 — dies to the counter
      unit("P-sword-1", "sword", "player", 6, 5, 2), // atk 7 def 5 — dies to the attack
    ];
    const moves: Move[] = [
      { unitId: "E-axe-1", path: [[5, 5]], action: { type: "attack", targetId: "P-sword-1" } },
    ];
    const applied = applyMoves({ board: plainBoard(), units }, moves, "enemy", engineConfig);
    if (!applied.ok) throw new Error(applied.error);

    const actions = toAiActions(moves, applied.result.events);
    expect(actions[0].outcome).toEqual({
      targetId: "P-sword-1",
      damage: 5, // 10 − 5 ⇒ target hp 2 → −3 → dead (hp ≤ 0 removes the unit)
      targetHp: -3,
      targetDied: true,
      counter: null, // dead units never counter
    });
  });

  it("keeps the counter when the attacker dies to it (targetDied stays false)", () => {
    const units = [
      unit("E-axe-1", "axe", "enemy", 5, 5, 4), // counter 7−3=4 kills the attacker
      unit("P-sword-1", "sword", "player", 6, 5), // survives 10−5=5
    ];
    const moves: Move[] = [
      { unitId: "E-axe-1", path: [[5, 5]], action: { type: "attack", targetId: "P-sword-1" } },
    ];
    const applied = applyMoves({ board: plainBoard(), units }, moves, "enemy", engineConfig);
    if (!applied.ok) throw new Error(applied.error);

    const actions = toAiActions(moves, applied.result.events);
    expect(actions[0].outcome).toEqual({
      targetId: "P-sword-1",
      damage: 5,
      targetHp: 15,
      targetDied: false,
      counter: { damage: 4, attackerHp: 0 }, // the attacker's hp AFTER the counter
    });
  });
});
