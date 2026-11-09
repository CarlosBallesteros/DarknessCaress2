import type { XY } from "../types/api";

export function manhattan(a: XY, b: XY): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}

const key = (t: XY): string => `${t[0]},${t[1]}`;

const parse = (k: string): XY => {
  const [x, y] = k.split(",");
  return [Number(x), Number(y)];
};

// 05: the client computes + displays the shortest legal path via a tiny client
// BFS over the preview's reachable tiles — pure UX sugar that serializes the
// staged bundle's path; the server re-derives legality on submission (06 ep. 13).
//
// The preview's moveTiles are final-ELIGIBLE tiles only (empty or own tile —
// ally-occupied tiles are pass-through per 00 but are not in the served set).
// For routing, the graph is moveTiles ∪ passThrough (ally tiles), while the
// destination must be a moveTile. This mirrors the engine's own reach rule and
// keeps every produced path acceptable to the server's re-validation.
export function shortestPath(
  moveTiles: XY[],
  passThrough: XY[],
  from: XY,
  to: XY,
): XY[] | null {
  if (from[0] === to[0] && from[1] === to[1]) {
    return [from];
  }
  const passable = new Set([...moveTiles, ...passThrough].map(key));
  if (
    !passable.has(key(to)) ||
    !moveTiles.some((t) => t[0] === to[0] && t[1] === to[1])
  ) {
    return null;
  }
  const prev = new Map<string, string | null>([[key(from), null]]);
  const queue: XY[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift() as XY;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next: XY = [cur[0] + dx, cur[1] + dy];
      const nk = key(next);
      if (prev.has(nk) || !passable.has(nk)) {
        continue;
      }
      prev.set(nk, key(cur));
      if (next[0] === to[0] && next[1] === to[1]) {
        queue.length = 0;
        break;
      }
      queue.push(next);
    }
  }
  if (!prev.has(key(to))) {
    return null;
  }
  const path: XY[] = [];
  let cursor: string | null = key(to);
  while (cursor !== null) {
    path.unshift(parse(cursor));
    cursor = prev.get(cursor) ?? null;
  }
  return path;
}
