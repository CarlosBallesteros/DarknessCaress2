// Hand-built state helpers shared by the engine suites (docs/02 test list).
// Tests run against the REAL projected config wherever the docs say
// "parametrized with the real config values".
import type { Board, ClassKey, Side, Tile, Unit } from "./types";
import { engineConfig } from "./engine-config";

export { engineConfig };

// 15×15 plain board (the fixture default SIZE from types.ts) with sparse
// overrides: entries are [x, y, tile].
export function makeBoard(
  overrides: Array<[number, number, Tile]> = [],
): Board {
  const size = engineConfig.boardSize;
  const tiles: Tile[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => "plain" as Tile),
  );
  for (const [x, y, tile] of overrides) tiles[y][x] = tile;
  return { tiles };
}

// Baseline HP comes from the projected config — never duplicated as literals.
export function makeUnit(
  id: string,
  side: Side,
  klass: ClassKey,
  x: number,
  y: number,
  overrides: Partial<Omit<Unit, "id" | "side" | "class">> = {},
): Unit {
  const maxHp = overrides.maxHp ?? engineConfig.classes[klass].hp;
  return {
    id,
    side,
    class: klass,
    x,
    y,
    hp: overrides.hp ?? maxHp,
    maxHp,
    acted: overrides.acted ?? false,
  };
}

export const p = (
  id: string,
  klass: ClassKey,
  x: number,
  y: number,
  o?: Partial<Unit>,
) => makeUnit(id, "player", klass, x, y, o);
export const e = (
  id: string,
  klass: ClassKey,
  x: number,
  y: number,
  o?: Partial<Unit>,
) => makeUnit(id, "enemy", klass, x, y, o);

export const move = (
  unitId: string,
  path: Array<[number, number]>,
  action:
    | { type: "attack"; targetId: string }
    | { type: "heal"; targetId: string }
    | { type: "wait" },
) => ({ unitId, path, action });

export const attack = (targetId: string) =>
  ({ type: "attack", targetId }) as const;
export const heal = (targetId: string) => ({ type: "heal", targetId }) as const;
export const wait = { type: "wait" } as const;
