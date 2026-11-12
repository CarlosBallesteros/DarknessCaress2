import type { Unit, ClassKey, Side } from "../../game/types.js";
import type { AppConfig } from "../../config/index.js";
import type { Rng } from "./prng.js";

const DISPLAY_ORDER: ClassKey[] = ["sword", "axe", "spear", "archer", "mage", "healer"];

export function createArmies(boardSize: number, config: AppConfig, rng: Rng): Unit[] {
  const units: Unit[] = [];
  for (const side of ["player", "enemy"] as const) {
    units.push(...createSideArmy(side, boardSize, config, rng));
  }
  return units;
}

function createSideArmy(side: Side, boardSize: number, config: AppConfig, rng: Rng): Unit[] {
  const frontRow = side === "player" ? boardSize - 2 : 1;
  const backRow = side === "player" ? boardSize - 1 : 0;

  const frontClasses: ClassKey[] = ["sword", "sword", "axe", "axe", "spear"];
  const backClasses: ClassKey[] = ["spear", "archer", "archer", "mage", "healer"];

  const counters: Record<ClassKey, number> = {
    sword: 0,
    axe: 0,
    spear: 0,
    archer: 0,
    mage: 0,
    healer: 0,
  };

  const placed: Unit[] = [];
  placeGroup(side, frontRow, frontClasses, boardSize, config, rng, counters, placed);
  placeGroup(side, backRow, backClasses, boardSize, config, rng, counters, placed);
  return placed;
}

function placeGroup(
  side: Side,
  row: number,
  group: ClassKey[],
  boardSize: number,
  config: AppConfig,
  rng: Rng,
  counters: Record<ClassKey, number>,
  out: Unit[],
): void {
  const cols = Array.from({ length: boardSize }, (_, i) => i);
  const shuffledCols = rng.shuffle(cols).slice(0, group.length);
  const shuffledGroup = rng.shuffle(group);
  for (let i = 0; i < shuffledGroup.length; i++) {
    const cls = shuffledGroup[i]!;
    const x = shuffledCols[i]!;
    counters[cls] += 1;
    const n = counters[cls];
    const clsCfg = config.classes[cls];
    const id = `${side === "player" ? "P" : "E"}-${cls}-${n}`;
    out.push({
      id,
      side,
      class: cls,
      x,
      y: row,
      hp: clsCfg.hp,
      maxHp: clsCfg.hp,
      acted: false,
    });
  }
}

// Ensure deterministic id/counting follows display order per class across rows if needed:
// spec states "n counted per class in display order; stable for the game's life" - our
// per-side counting in placement order within groups could vary; but groups are fixed
// (front gets 2 swords,2 axes,1 spear; back gets remaining spear etc.). To be safe and
// stable, we assign ids by display order counting after building positions? However placement
// is shuffled. Spec: "Unit ids are `<P|E>-<class>-<n>`... n counted per class in display order"
// - likely 1st/2nd of that class in canonical display/listing order, not spatial order.
// We'll post-process to normalize ids per side by class display order of created units.
export function normalizeUnitIds(units: Unit[]): Unit[] {
  const bySide: Record<Side, Unit[]> = { player: [], enemy: [] };
  for (const u of units) bySide[u.side].push(u);
  const result: Unit[] = [];
  for (const side of ["player", "enemy"] as const) {
    const sideUnits = bySide[side];
    const counters: Record<ClassKey, number> = {
      sword: 0,
      axe: 0,
      spear: 0,
      archer: 0,
      mage: 0,
      healer: 0,
    };
    // assign in display order, but we must keep same unit instances/positions; map by class occurrence
    const queues: Record<ClassKey, Unit[]> = {
      sword: [],
      axe: [],
      spear: [],
      archer: [],
      mage: [],
      healer: [],
    };
    for (const cls of DISPLAY_ORDER) {
      queues[cls] = sideUnits.filter((u) => u.class === cls);
    }
    for (const cls of DISPLAY_ORDER) {
      for (const u of queues[cls]) {
        counters[cls] += 1;
        result.push({ ...u, id: `${side === "player" ? "P" : "E"}-${cls}-${counters[cls]}` });
      }
    }
  }
  return result;
}
