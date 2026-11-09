import type { Board, ClassKey, Side, Unit } from "./game/types.js";

/** A fully plain board — tests position units explicitly on it. */
export function plainBoard(size = 15): Board {
  return {
    tiles: Array.from({ length: size }, () =>
      Array.from({ length: size }, () => "plain" as const),
    ),
  };
}

/** A crafted scenario unit; hp/maxHp are explicit scenario data, not balance. */
export function unit(
  id: string,
  side: Side,
  klass: ClassKey,
  x: number,
  y: number,
  hp: number,
  overrides: Partial<Unit> = {},
): Unit {
  return {
    id,
    side,
    class: klass,
    x,
    y,
    hp,
    maxHp: overrides.maxHp ?? hp,
    acted: false,
    ...overrides,
  };
}
