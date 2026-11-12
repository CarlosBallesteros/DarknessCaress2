import { pathTo, previewMove } from "../../game/reach.js";
import type { Board, GameEngineConfig, Unit } from "../../game/types.js";

export type Difficulty = "aggressive" | "defensive" | "erratic";

export interface DestinationOrder {
  unitId: string;
  to?: [number, number];
  action:
    { type: "attack"; targetId: string } | { type: "heal"; targetId: string } | { type: "wait" };
}

type AttackPair = { kind: "attack"; targetId: string; to: [number, number] };
type HealPair = { kind: "heal"; targetId: string; to: [number, number] };
type MoveOption = { kind: "move"; to: [number, number] }; // wait action at destination

type LegalOption = AttackPair | HealPair | MoveOption;

const key = (x: number, y: number) => `${x},${y}`;

function cloneUnits(units: Unit[]): Unit[] {
  return units.map((u) => ({ ...u }));
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function findUnit(units: Unit[], id: string): Unit | undefined {
  return units.find((u) => u.id === id);
}

function playerUnits(units: Unit[]): Unit[] {
  return units.filter((u) => u.side === "player" && u.hp > 0);
}

function distanceToNearestPlayer(units: Unit[], x: number, y: number): number {
  const players = playerUnits(units);
  if (players.length === 0) return 0;
  let best = Infinity;
  for (const p of players) {
    const d = manhattan(x, y, p.x, p.y);
    if (d < best) best = d;
  }
  return best;
}

function tileInSpawnTopRows(y: number, boardSize: number): boolean {
  // enemy spawn side is top rows (0-1). "on/near the spawn side (top rows)"
  return y <= 1 || y <= Math.floor(boardSize / 2) - 1;
}

function isClaimed(claimed: Set<string>, x: number, y: number): boolean {
  return claimed.has(key(x, y));
}

function computeLegalOptions(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
  claimed: Set<string>,
): LegalOption[] {
  const cls = cfg.classes[unit.class];
  const preview = previewMove(board, units, unit, cfg);
  const moveTiles = preview.moveTiles;
  const options: LegalOption[] = [];

  // Attack pairs
  if (cls.atk > 0 && cls.range.length > 0) {
    for (const target of units) {
      if (target.side === unit.side) continue;
      // target must be attackable from any reachable tile -> derive valid `to` destinations
      const tos: [number, number][] = [];
      for (const mt of moveTiles) {
        const dist = manhattan(mt[0], mt[1], target.x, target.y);
        if (cls.range.includes(dist) && !isClaimed(claimed, mt[0], mt[1])) {
          // ensure destination standable/path in current snapshot (reachable already implies path/standable)
          tos.push([mt[0], mt[1]]);
        }
      }
      // de-duplicate tos
      const seen = new Set<string>();
      for (const to of tos) {
        const k = key(to[0], to[1]);
        if (seen.has(k)) continue;
        seen.add(k);
        options.push({ kind: "attack", targetId: target.id, to });
      }
    }
  }

  // Heal pairs (healer, healAmount present)
  if (cls.healAmount !== undefined) {
    for (const ally of units) {
      if (ally.side !== unit.side) continue;
      if (ally.hp >= ally.maxHp) continue;
      const tos: [number, number][] = [];
      for (const mt of moveTiles) {
        const dist = manhattan(mt[0], mt[1], ally.x, ally.y);
        if (dist === 1 && !isClaimed(claimed, mt[0], mt[1])) {
          tos.push([mt[0], mt[1]]);
        }
      }
      const seen = new Set<string>();
      for (const to of tos) {
        const k = key(to[0], to[1]);
        if (seen.has(k)) continue;
        seen.add(k);
        options.push({ kind: "heal", targetId: ally.id, to });
      }
    }
  }

  // Move-only / wait options (reachable moveTiles, including stay-in-place)
  // If unit has attack/heal pairs, those `to` tiles are action-relevant destinations but
  // move/wait options are still legal choices conceptually? "units with no attack/heal pairs choose from reachable moveTiles..."
  // implies move-only for those without pairs. However erratic picks among "any valid attack pair, heal pair, or move/wait".
  // So include move/wait options regardless to satisfy erratic's full legal option space.
  const moveSeen = new Set<string>();
  for (const mt of moveTiles) {
    const k = key(mt[0], mt[1]);
    if (moveSeen.has(k)) continue;
    if (isClaimed(claimed, mt[0], mt[1])) continue;
    moveSeen.add(k);
    options.push({ kind: "move", to: [mt[0], mt[1]] });
  }
  // ensure stay-in-place is present if legal/unclaimed (usually included in moveTiles)
  if (!moveSeen.has(key(unit.x, unit.y)) && !isClaimed(claimed, unit.x, unit.y)) {
    options.push({ kind: "move", to: [unit.x, unit.y] });
  }

  return options;
}

function chooseAggressive(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
  claimed: Set<string>,
): DestinationOrder {
  const options = computeLegalOptions(board, units, unit, cfg, claimed);
  const attacks = options.filter((o): o is AttackPair => o.kind === "attack");
  const heals = options.filter((o): o is HealPair => o.kind === "heal");
  const moves = options.filter((o): o is MoveOption => o.kind === "move");
  const cls = cfg.classes[unit.class];

  // Healer special case
  if (cls.healAmount !== undefined) {
    if (heals.length > 0) {
      // prefer heal pairs for the most wounded eligible ally
      let best: HealPair | null = null;
      for (const h of heals) {
        const ally = findUnit(units, h.targetId);
        if (!ally) continue;
        if (!best) {
          best = h;
          continue;
        }
        const bestAlly = findUnit(units, best.targetId);
        if (!bestAlly) {
          best = h;
          continue;
        }
        const missing = ally.maxHp - ally.hp;
        const bestMissing = bestAlly.maxHp - bestAlly.hp;
        if (missing !== bestMissing) {
          if (missing > bestMissing) best = h;
          continue;
        }
        if (h.targetId !== best.targetId) {
          if (h.targetId < best.targetId) best = h;
          continue;
        }
        if (h.to[1] !== best.to[1] || h.to[0] !== best.to[0]) {
          if (h.to[1] < best.to[1] || (h.to[1] === best.to[1] && h.to[0] < best.to[0])) best = h;
        }
      }
      if (best) {
        return toOrder(unit.id, best);
      }
    }
    // if none, stays safe/back (does not rush the front) and does not attack
    // choose move maximizing distance from nearest player, preferring spawn side/top rows
    return chooseSafeBackMove(unit, moves, units, cfg);
  }

  if (attacks.length > 0) {
    // prefer supporter-role player units, then lowest hp, then smallest Manhattan distance from the unit
    let best: AttackPair | null = null;
    for (const a of attacks) {
      const target = findUnit(units, a.targetId);
      if (!target) continue;
      if (!best) {
        best = a;
        continue;
      }
      const bt = findUnit(units, best.targetId)!;
      const aSupport = (cfg.classes[target.class].role ?? "attacker") === "supporter" ? 1 : 0;
      const bSupport = (cfg.classes[bt.class].role ?? "attacker") === "supporter" ? 1 : 0;
      if (aSupport !== bSupport) {
        if (aSupport > bSupport) best = a;
        continue;
      }
      if (target.hp !== bt.hp) {
        if (target.hp < bt.hp) best = a;
        continue;
      }
      const ad = manhattan(unit.x, unit.y, target.x, target.y);
      const bd = manhattan(unit.x, unit.y, bt.x, bt.y);
      if (ad !== bd) {
        if (ad < bd) best = a;
        continue;
      }
      // deterministic tie-break: choose paired `to` that minimizes distance to that target
      const aToD = manhattan(a.to[0], a.to[1], target.x, target.y);
      const bToD = manhattan(best.to[0], best.to[1], bt.x, bt.y);
      if (aToD !== bToD) {
        if (aToD < bToD) best = a;
        continue;
      }
      // final stable tie-break
      if (a.targetId < best.targetId) best = a;
      else if (a.targetId === best.targetId) {
        if (a.to[1] < best.to[1] || (a.to[1] === best.to[1] && a.to[0] < best.to[0])) best = a;
      }
    }
    // for the chosen target, ensure `to` minimizes distance to that target among pairs for same target?
    if (best) {
      const target = findUnit(units, best.targetId)!;
      let chosen = best;
      for (const a of attacks) {
        if (a.targetId !== best.targetId) continue;
        const cd = manhattan(a.to[0], a.to[1], target.x, target.y);
        const bd = manhattan(chosen.to[0], chosen.to[1], target.x, target.y);
        if (cd < bd) chosen = a;
        else if (cd === bd) {
          if (a.to[1] < chosen.to[1] || (a.to[1] === chosen.to[1] && a.to[0] < chosen.to[0]))
            chosen = a;
        }
      }
      return toOrder(unit.id, chosen);
    }
  }

  // Units with no attack pairs advance: pick reachable/move `to` that minimizes distance to nearest surviving player unit
  return chooseAdvanceMove(unit, moves, units);
}

function chooseSafeBackMove(
  unit: Unit,
  moves: MoveOption[],
  units: Unit[],
  _cfg: GameEngineConfig,
): DestinationOrder {
  void _cfg;
  if (moves.length === 0) {
    return { unitId: unit.id, action: { type: "wait" } };
  }
  let best = moves[0];
  for (let i = 1; i < moves.length; i++) {
    const m = moves[i];
    const bd = distanceToNearestPlayer(units, best.to[0], best.to[1]);
    const md = distanceToNearestPlayer(units, m.to[0], m.to[1]);
    if (md !== bd) {
      if (md > bd) best = m;
      continue;
    }
    // prefer spawn side/top rows (smaller y)
    if (m.to[1] !== best.to[1]) {
      if (m.to[1] < best.to[1]) best = m;
      continue;
    }
    if (m.to[0] < best.to[0]) best = m;
  }
  // avoid rushing front: if staying is viable and as safe, prefer closer to top
  return toOrder(unit.id, best);
}

function chooseAdvanceMove(unit: Unit, moves: MoveOption[], units: Unit[]): DestinationOrder {
  if (moves.length === 0) {
    return { unitId: unit.id, action: { type: "wait" } };
  }
  let best = moves[0];
  for (let i = 1; i < moves.length; i++) {
    const m = moves[i];
    const bd = distanceToNearestPlayer(units, best.to[0], best.to[1]);
    const md = distanceToNearestPlayer(units, m.to[0], m.to[1]);
    if (md !== bd) {
      if (md < bd) best = m;
      continue;
    }
    // deterministic tie-break
    if (m.to[1] !== best.to[1]) {
      if (m.to[1] < best.to[1]) best = m; // arbitrary but stable
      continue;
    }
    if (m.to[0] < best.to[0]) best = m;
  }
  return toOrder(unit.id, best);
}

function chooseDefensive(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
  claimed: Set<string>,
): DestinationOrder {
  const options = computeLegalOptions(board, units, unit, cfg, claimed);
  const attacks = options.filter((o): o is AttackPair => o.kind === "attack");
  const heals = options.filter((o): o is HealPair => o.kind === "heal");
  const moves = options.filter((o): o is MoveOption => o.kind === "move");
  const cls = cfg.classes[unit.class];
  const curDist = distanceToNearestPlayer(units, unit.x, unit.y);

  // Healer: protect (keep back, heal when a pair exists)
  if (cls.healAmount !== undefined) {
    if (heals.length > 0) {
      // heal most wounded, but prefer safer `to` (farther from nearest player / closer to top)
      let best = heals[0];
      for (let i = 1; i < heals.length; i++) {
        const h = heals[i];
        const ba = findUnit(units, best.targetId)!;
        const ha = findUnit(units, h.targetId)!;
        const bMissing = ba.maxHp - ba.hp;
        const hMissing = ha.maxHp - ha.hp;
        if (hMissing !== bMissing) {
          if (hMissing > bMissing) best = h;
          continue;
        }
        const bd = distanceToNearestPlayer(units, best.to[0], best.to[1]);
        const hd = distanceToNearestPlayer(units, h.to[0], h.to[1]);
        if (hd !== bd) {
          if (hd > bd) best = h;
          continue;
        }
        if (h.to[1] !== best.to[1]) {
          if (h.to[1] < best.to[1]) best = h;
          continue;
        }
        if (h.to[0] < best.to[0]) best = h;
      }
      return toOrder(unit.id, best);
    }
    return chooseDefensiveHoldMove(unit, moves, units, cfg);
  }

  // Attack only when available without needlessly advancing forward into danger
  // prefer attacking from a `to` no closer to the nearest player unit than the current position, when such a pair exists
  if (attacks.length > 0) {
    const safeAttacks = attacks.filter(
      (a) => distanceToNearestPlayer(units, a.to[0], a.to[1]) >= curDist,
    );
    const pool = safeAttacks.length > 0 ? safeAttacks : [];
    if (pool.length > 0) {
      // choose a good defensive attack: prefer staying back, and still reasonable target (supporter/low hp)
      let best = pool[0];
      for (let i = 1; i < pool.length; i++) {
        const a = pool[i];
        const bt = findUnit(units, best.targetId)!;
        const at = findUnit(units, a.targetId)!;
        // prefer `to` farther from nearest player / closer to top
        const bd = distanceToNearestPlayer(units, best.to[0], best.to[1]);
        const ad = distanceToNearestPlayer(units, a.to[0], a.to[1]);
        if (ad !== bd) {
          if (ad > bd) best = a;
          continue;
        }
        if (a.to[1] !== best.to[1]) {
          if (a.to[1] < best.to[1]) best = a;
          continue;
        }
        // prefer supporter targets, then lower hp
        const aSup = (cfg.classes[at.class].role ?? "attacker") === "supporter" ? 1 : 0;
        const bSup = (cfg.classes[bt.class].role ?? "attacker") === "supporter" ? 1 : 0;
        if (aSup !== bSup) {
          if (aSup > bSup) best = a;
          continue;
        }
        if (at.hp !== bt.hp) {
          if (at.hp < bt.hp) best = a;
          continue;
        }
        if (a.targetId < best.targetId) best = a;
      }
      return toOrder(unit.id, best);
    }
  }

  // otherwise favor a safe move/wait
  return chooseDefensiveHoldMove(unit, moves, units, cfg);
}

function chooseDefensiveHoldMove(
  unit: Unit,
  moves: MoveOption[],
  units: Unit[],
  cfg: GameEngineConfig,
): DestinationOrder {
  if (moves.length === 0) {
    return { unitId: unit.id, action: { type: "wait" } };
  }
  // Prefer holding ground behind own lines: choose `to` that maximizes distance from the nearest player unit
  // while staying on/near the spawn side (top rows); avoid advancing into the open when no safe advantage exists.
  let best = moves[0];
  for (let i = 1; i < moves.length; i++) {
    const m = moves[i];
    const bd = distanceToNearestPlayer(units, best.to[0], best.to[1]);
    const md = distanceToNearestPlayer(units, m.to[0], m.to[1]);
    const bNear = tileInSpawnTopRows(best.to[1], cfg.boardSize) ? 1 : 0;
    const mNear = tileInSpawnTopRows(m.to[1], cfg.boardSize) ? 1 : 0;

    // primary: stay on/near spawn side (top rows) when possible, combined with maximizing distance from nearest player
    if (mNear !== bNear) {
      if (mNear > bNear) best = m;
      continue;
    }
    if (md !== bd) {
      if (md > bd) best = m;
      continue;
    }
    // prefer smaller y (behind own lines)
    if (m.to[1] !== best.to[1]) {
      if (m.to[1] < best.to[1]) best = m;
      continue;
    }
    // prefer staying put if equally good (hold ground)
    const bStay = best.to[0] === unit.x && best.to[1] === unit.y ? 1 : 0;
    const mStay = m.to[0] === unit.x && m.to[1] === unit.y ? 1 : 0;
    if (mStay !== bStay) {
      if (mStay > bStay) best = m;
      continue;
    }
    if (m.to[0] < best.to[0]) best = m;
  }
  return toOrder(unit.id, best);
}

function chooseErratic(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
  claimed: Set<string>,
  rng: () => number,
): DestinationOrder {
  const options = computeLegalOptions(board, units, unit, cfg, claimed);
  if (options.length === 0) {
    return { unitId: unit.id, action: { type: "wait" } };
  }
  const idx = Math.floor(rng() * options.length);
  const choice = options[Math.max(0, Math.min(options.length - 1, idx))];
  return toOrder(unit.id, choice);
}

function toOrder(unitId: string, opt: LegalOption): DestinationOrder {
  if (opt.kind === "attack") {
    return { unitId, to: opt.to, action: { type: "attack", targetId: opt.targetId } };
  }
  if (opt.kind === "heal") {
    return { unitId, to: opt.to, action: { type: "heal", targetId: opt.targetId } };
  }
  // move/wait
  return { unitId, to: opt.to, action: { type: "wait" } };
}

export function computeEnemyOrders(
  board: Board,
  units: Unit[],
  difficulty: Difficulty,
  cfg: GameEngineConfig,
  rng: () => number = Math.random,
): DestinationOrder[] {
  const working = cloneUnits(units);
  const claimed = new Set<string>();
  const orders: DestinationOrder[] = [];

  // stable unit order (enemy units by id)
  const enemies = working
    .filter((u) => u.side === "enemy" && u.hp > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const enemy of enemies) {
    // find current reference in working snapshot (positions evolve)
    const current = findUnit(working, enemy.id);
    if (!current) continue;

    let order: DestinationOrder;
    if (difficulty === "aggressive") {
      order = chooseAggressive(board, working, current, cfg, claimed);
    } else if (difficulty === "defensive") {
      order = chooseDefensive(board, working, current, cfg, claimed);
    } else {
      order = chooseErratic(board, working, current, cfg, claimed, rng);
    }

    // Ensure chosen `to` is not claimed and is legal in current snapshot; fallback if needed
    const resolved = resolveOrderWithFallback(board, working, current, cfg, claimed, order);
    orders.push(resolved);

    const to = resolved.to ?? [current.x, current.y];
    const toKey = key(to[0], to[1]);
    claimed.add(toKey);
    // evolve snapshot: move unit to destination
    current.x = to[0];
    current.y = to[1];
  }

  return orders;
}

function resolveOrderWithFallback(
  board: Board,
  units: Unit[],
  unit: Unit,
  cfg: GameEngineConfig,
  claimed: Set<string>,
  preferred: DestinationOrder,
): DestinationOrder {
  const to = preferred.to ?? [unit.x, unit.y];
  const toKey = key(to[0], to[1]);
  const path = pathTo(board, units, unit, to, cfg);
  if (!claimed.has(toKey) && path) {
    return preferred;
  }

  // fallback to next-best legal option (or wait-in-place)
  const options = computeLegalOptions(board, units, unit, cfg, claimed);
  // try to keep same action intent if possible
  if (preferred.action.type === "attack") {
    const preferredTargetId = preferred.action.targetId;
    const sameTarget = options.find(
      (o): o is AttackPair =>
        o.kind === "attack" &&
        o.targetId === preferredTargetId &&
        !!pathTo(board, units, unit, o.to, cfg),
    );
    if (sameTarget) return toOrder(unit.id, sameTarget);
    const anyAttack = options.find(
      (o): o is AttackPair => o.kind === "attack" && !!pathTo(board, units, unit, o.to, cfg),
    );
    if (anyAttack) return toOrder(unit.id, anyAttack);
  } else if (preferred.action.type === "heal") {
    const preferredTargetId = preferred.action.targetId;
    const sameTarget = options.find(
      (o): o is HealPair =>
        o.kind === "heal" &&
        o.targetId === preferredTargetId &&
        !!pathTo(board, units, unit, o.to, cfg),
    );
    if (sameTarget) return toOrder(unit.id, sameTarget);
    const anyHeal = options.find(
      (o): o is HealPair => o.kind === "heal" && !!pathTo(board, units, unit, o.to, cfg),
    );
    if (anyHeal) return toOrder(unit.id, anyHeal);
  }

  // fallback to any legal move/wait, prefer stay-in-place
  const stay = options.find(
    (o): o is MoveOption =>
      o.kind === "move" &&
      o.to[0] === unit.x &&
      o.to[1] === unit.y &&
      !!pathTo(board, units, unit, o.to, cfg),
  );
  if (stay) return toOrder(unit.id, stay);
  const anyMove = options.find(
    (o): o is MoveOption => o.kind === "move" && !!pathTo(board, units, unit, o.to, cfg),
  );
  if (anyMove) return toOrder(unit.id, anyMove);

  return { unitId: unit.id, action: { type: "wait" } };
}
