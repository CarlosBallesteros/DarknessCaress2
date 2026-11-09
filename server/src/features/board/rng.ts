/**
 * Deterministic seeded PRNG (mulberry32) — "the seeded PRNG, same family as
 * materialization" (03): the river walk, the rock sprinkle and the army
 * scatter all draw from it. Same seed ⇒ same sequence, forever.
 */
export interface SeededRng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** In-place Fisher–Yates; returns the same array. */
  shuffle<T>(items: T[]): T[];
}

export function createRng(seed: number): SeededRng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  return {
    next,
    int: (maxExclusive) => Math.floor(next() * maxExclusive),
    shuffle: (items) => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    },
  };
}
