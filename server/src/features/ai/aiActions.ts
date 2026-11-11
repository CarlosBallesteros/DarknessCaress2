// The engine's event stream mapped onto the contract's AiAction DTO
// (docs/06 shared DTOs): one action per bundle entry, in execution order.
// The engine counter event carries targetId = the COUNTERER + its post-hit
// hp — the DTO flips it: damage goes to counter.damage, attackerHp = the
// attacker's hp AFTER the counter, read from the applied events (never
// recomputed client-side).
import type { AppliedTurn } from "../../game/apply";
import type { Move } from "../../game/types";
import type { AiAction } from "../games/dto";

export function toAiActions(moves: Move[], events: AppliedTurn["events"]): AiAction[] {
  const actions: AiAction[] = [];
  let cursor = 0;
  for (const move of moves) {
    // Each entry's events are contiguous: an optional `moved`, then the
    // action event, then its follow-ups (counter / died).
    const first = events[cursor];
    if (first !== undefined && first.kind === "moved" && first.unitId === move.unitId) {
      cursor++;
    }
    const event = events[cursor];
    if (event === undefined) break;
    if (event.kind === "wait") {
      actions.push({ unitId: move.unitId, path: move.path, action: move.action, outcome: null });
      cursor++;
      continue;
    }
    if (event.kind === "attack") {
      cursor++;
      let counter: { damage: number; attackerHp: number } | null = null;
      let targetDied = false;
      while (cursor < events.length) {
        const follow = events[cursor];
        if (follow.kind !== "counter" && follow.kind !== "died") break;
        if (follow.kind === "counter") {
          counter = { damage: follow.damage, attackerHp: follow.targetHp };
        }
        if (follow.kind === "died" && follow.unitId === event.targetId) {
          targetDied = true;
        }
        cursor++;
      }
      actions.push({
        unitId: move.unitId,
        path: move.path,
        action: move.action,
        outcome: {
          targetId: event.targetId,
          damage: event.damage,
          targetHp: event.targetHp,
          targetDied,
          counter,
        },
      });
      continue;
    }
    if (event.kind !== "heal") break; // unreachable from a well-aligned cursor
    // heal — outcome damage carries the amount healed (docs/06 DTO note).
    actions.push({
      unitId: move.unitId,
      path: move.path,
      action: move.action,
      outcome: {
        targetId: event.targetId,
        damage: event.healed,
        targetHp: event.targetHp,
        targetDied: false,
        counter: null,
      },
    });
    cursor++;
  }
  return actions;
}
