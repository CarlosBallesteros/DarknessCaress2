import type { AppliedTurn } from "../../game/apply.js";
import type { Move } from "../../game/types.js";

/** The enemy's last produced turn, for board animation (06's AiAction DTO). */
export interface AiAction {
  unitId: string;
  path: [number, number][];
  action: Move["action"];
  outcome: {
    targetId: string;
    damage: number;
    targetHp: number;
    targetDied: boolean;
    counter: { damage: number; attackerHp: number } | null;
  } | null;
}

type Event = AppliedTurn["events"][number];

/**
 * Maps the engine's event list to 06's AiAction DTO, in execution order (the
 * bundle's order — applyMoves resolves entries strictly sequentially). The
 * engine's counter event carries targetId = the COUNTERER and targetHp = the
 * ATTACKER's hp AFTER the counter; the DTO flips it into
 * `counter: { damage, attackerHp }` exactly as 06 prescribes.
 */
export function toAiActions(
  moves: Move[],
  events: AppliedTurn["events"],
): AiAction[] {
  const attackEvent = (unitId: string) =>
    events.find(
      (event): event is Extract<Event, { kind: "attack" }> =>
        event.kind === "attack" && event.attackerId === unitId,
    );
  const healEvent = (unitId: string) =>
    events.find(
      (event): event is Extract<Event, { kind: "heal" }> =>
        event.kind === "heal" && event.healerId === unitId,
    );
  const counterAgainst = (unitId: string) =>
    events.find(
      (event): event is Extract<Event, { kind: "counter" }> =>
        event.kind === "counter" && event.attackerId === unitId,
    );
  const died = (unitId: string) =>
    events.some((event) => event.kind === "died" && event.unitId === unitId);

  return moves.map((move) => {
    const base = { unitId: move.unitId, path: move.path, action: move.action };
    if (move.action.type === "wait") {
      return { ...base, outcome: null };
    }
    if (move.action.type === "heal") {
      const heal = healEvent(move.unitId);
      if (heal === undefined) {
        throw new Error(`no heal event for ${move.unitId}`);
      }
      return {
        ...base,
        outcome: {
          targetId: heal.targetId,
          damage: heal.healed,
          targetHp: heal.targetHp,
          targetDied: false,
          counter: null,
        },
      };
    }
    const attack = attackEvent(move.unitId);
    if (attack === undefined) {
      throw new Error(`no attack event for ${move.unitId}`);
    }
    const counter = counterAgainst(move.unitId);
    return {
      ...base,
      outcome: {
        targetId: attack.targetId,
        damage: attack.damage,
        targetHp: attack.targetHp,
        targetDied: died(attack.targetId),
        counter:
          counter === undefined
            ? null
            : { damage: counter.damage, attackerHp: counter.targetHp },
      },
    };
  });
}
