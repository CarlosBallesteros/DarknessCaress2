import type {
  ClassKey,
  GameEngineConfig,
  Side,
  Unit,
} from "../../game/types.js";
import { createRng } from "./rng.js";

export const SPAWN_BLOCK_WIDTH = 8;

/** Columns 4-11 at baseline: the 8-wide block is centered on the board (03). */
export function spawnBlockStart(size: number): number {
  return Math.ceil((size - SPAWN_BLOCK_WIDTH) / 2);
}

const DISPLAY_ORDER: ClassKey[] = [
  "sword",
  "axe",
  "spear",
  "archer",
  "mage",
  "healer",
];

/**
 * The 8×2 spawn blocks with the seeded scatter of 03. Front row (nearer the
 * river/center): the 2 swords, 2 axes and the first spear; back row: the
 * remaining spear, 2 archers, mage, healer — the healer NEVER fronts. Per side
 * and row the PRNG shuffles the block's 8 columns and the first columns of the
 * permutation receive that group's units, in group order; the rest stay empty
 * (3 gaps per row). Sides scatter independently (no mirror symmetry) and the
 * same seed always reproduces the exact same arrangement. Unit ids are
 * `<P|E>-<class>-<n>`, n counted per class in display order, stable for the
 * game's life; on spawn hp = maxHp and acted = false.
 */
export function placeArmies(seed: number, cfg: GameEngineConfig): Unit[] {
  const size = cfg.boardSize;
  const columns = Array.from(
    { length: SPAWN_BLOCK_WIDTH },
    (_, i) => spawnBlockStart(size) + i,
  );
  const rng = createRng(seed);
  const units: Unit[] = [];
  for (const side of ["player", "enemy"] as Side[]) {
    const prefix = side === "player" ? "P" : "E";
    const frontRow = side === "player" ? size - 2 : 1;
    const backRow = side === "player" ? size - 1 : 0;
    const front: Unit[] = [];
    const back: Unit[] = [];
    for (const key of DISPLAY_ORDER) {
      const stats = cfg.classes[key];
      for (let n = 1; n <= stats.count; n++) {
        const unit: Unit = {
          id: `${prefix}-${key}-${n}`,
          side,
          class: key,
          x: 0,
          y: 0,
          hp: stats.hp,
          maxHp: stats.hp,
          acted: false,
        };
        const fronts =
          key === "sword" || key === "axe" || (key === "spear" && n === 1);
        (fronts ? front : back).push(unit);
      }
    }
    for (const [group, row] of [
      [front, frontRow],
      [back, backRow],
    ] as const) {
      const shuffled = rng.shuffle([...columns]);
      group.forEach((unit, i) => {
        unit.x = shuffled[i] as number;
        unit.y = row;
        units.push(unit);
      });
    }
  }
  return units;
}
