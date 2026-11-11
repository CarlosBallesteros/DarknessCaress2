// Army spawn layout (docs/03): each army occupies an 8×2 block (columns 4-11
// at baseline), 16 slots, 10 units, 6 gaps. Front row per side = the row
// nearer the middle (player: 13; enemy: 1). The seeded PRNG (same family as
// materialization) shuffles the 8 columns per side and per row; the first
// columns receive that group's units in fixed class order, the rest stay
// empty — gaps vary per game, the same game always reproduces the exact same
// arrangement, and the sides scatter independently.
import type { ClassKey, GameEngineConfig, Side, Unit } from "../../game/types";
import { backComposition, frontComposition, totalArmySize } from "./invariants";
import { SPAWN_BLOCK_COLUMNS, spawnBlockStartColumn } from "./materialize";
import { mulberry32, shuffled } from "./prng";

export function assembleArmies(seed: number, cfg: GameEngineConfig): Unit[] {
  const size = cfg.boardSize;
  const columns = Array.from(
    { length: SPAWN_BLOCK_COLUMNS },
    (_, i) => spawnBlockStartColumn(size) + i,
  );
  const rng = mulberry32(seed);

  const units: Unit[] = [];
  const place = (side: Side, frontRow: number, backRow: number) => {
    const counters: Partial<Record<ClassKey, number>> = {};
    const placeGroup = (group: ClassKey[], row: number) => {
      const permutation = shuffled(columns, rng);
      group.forEach((cls, index) => {
        counters[cls] = (counters[cls] ?? 0) + 1;
        const stats = cfg.classes[cls];
        units.push({
          // Unit ids are counted per class in display order (docs/03):
          // creation order is the front group first, then the back group.
          id: `${side === "player" ? "P" : "E"}-${cls}-${counters[cls]}`,
          side,
          class: cls,
          x: permutation[index],
          y: row,
          hp: stats.hp,
          maxHp: stats.hp,
          acted: false,
        });
      });
    };
    placeGroup(frontComposition(cfg), frontRow);
    placeGroup(backComposition(cfg), backRow);
  };

  place("player", size - 2, size - 1); // player front = row 13, back = row 14
  place("enemy", 1, 0); // enemy front = row 1, back = row 0 — mirrored top-to-bottom

  if (units.length !== totalArmySize(cfg) * 2) {
    throw new Error("config counts do not fill the two spawn rows of both armies");
  }
  return units;
}
