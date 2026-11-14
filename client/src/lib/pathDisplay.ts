export type Point = [number, number];

const DIRS: Point[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

/**
 * Compute a shortest display path from origin to destination over the preview's
 * reachable destination tiles (plus origin). Pure UX sugar; server re-validates.
 */
export function computeDisplayPath(
  origin: Point,
  destination: Point,
  moveTiles: Point[],
): Point[] | null {
  if (origin[0] === destination[0] && origin[1] === destination[1]) {
    return [origin];
  }

  const allowed = new Set<string>([key(origin[0], origin[1])]);
  for (const [x, y] of moveTiles) {
    allowed.add(key(x, y));
  }
  if (!allowed.has(key(destination[0], destination[1]))) {
    return null;
  }

  const queue: Point[] = [origin];
  const prev = new Map<string, Point | null>();
  prev.set(key(origin[0], origin[1]), null);

  for (let qi = 0; qi < queue.length; qi++) {
    const cur = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const nx = cur[0] + dx;
      const ny = cur[1] + dy;
      const nk = key(nx, ny);
      if (!allowed.has(nk) || prev.has(nk)) continue;
      prev.set(nk, cur);
      if (nx === destination[0] && ny === destination[1]) {
        const path: Point[] = [[nx, ny]];
        let back: Point | null = cur;
        while (back) {
          path.push(back);
          back = prev.get(key(back[0], back[1])) ?? null;
        }
        path.reverse();
        return path;
      }
      queue.push([nx, ny]);
    }
  }

  return null;
}

export function manhattan(a: Point, b: Point): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
}
