import type { APIRequestContext } from "@playwright/test";
import { endTurn, getGame, getMeta, getPreview, postMoves } from "./api";
import type { GameState, Meta, Move, Unit } from "./api";

/**
 * The win-only play-bot of the stats/win-loss spec. Docs/04's standalone mock
 * turn is deliberately minimal (the first enemy by id steps one adjacent tile
 * and waits — it never attacks), so a UI-driven victory would need hundreds
 * of rounds; the bot instead plays the contract endpoints (endpoint 12
 * preview → 13 moves → 14 end-turn → poll) round after round until the
 * engine's own victory short-circuit fires. Every legality is server-side —
 * the bot only proposes; a rejected bundle fails the test loudly.
 */

const WATER_TILES = new Set(["lake", "river"]);

const key = (x: number, y: number): string => `${x},${y}`;

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

/**
 * Shortest legal walk tile-by-tile (mirrors the engine's path catalogue):
 * water impassable, enemy tiles may not be entered, ally tiles are
 * pass-through, no step may leave the reach budget guaranteed by the
 * preview's moveTiles (the bot only picks destinations from there).
 */
function walkPath(game: GameState, unit: Unit, dest: [number, number]): Array<[number, number]> {
  const tiles = game.board.tiles;
  const bound = tiles.length;
  // enemy tiles fully block passage; ally tiles are pass-through (00/02)
  const enemyTiles = new Set(
    game.units.filter((u) => u.side === "enemy").map((u) => key(u.x, u.y)),
  );

  const parent = new Map<string, string | null>([[key(unit.x, unit.y), null]]);
  const frontier: Array<[number, number]> = [[unit.x, unit.y]];
  while (frontier.length > 0) {
    const [x, y] = frontier.shift() as [number, number];
    if (x === dest[0] && y === dest[1]) {
      break;
    }
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      const k = key(nx, ny);
      if (parent.has(k)) {
        continue;
      }
      if (nx < 0 || ny < 0 || nx >= bound || ny >= bound) {
        continue;
      }
      if (WATER_TILES.has(tiles[ny]?.[nx] ?? "lake")) {
        continue;
      }
      if (enemyTiles.has(k)) {
        continue;
      }
      parent.set(k, key(x, y));
      frontier.push([nx, ny]);
    }
  }
  const path: Array<[number, number]> = [];
  let cursor: string | null = key(dest[0], dest[1]);
  while (cursor !== null) {
    const [x, y] = cursor.split(",").map(Number) as [number, number];
    path.unshift([x, y]);
    cursor = parent.get(cursor) ?? null;
  }
  return path;
}

interface AttackPair {
  dest: [number, number];
  target: Unit;
  damage: number;
  counterDamage: number;
}

/**
 * One round's bundle. Everything stages through the server's own preview
 * endpoint (endpoint 12) — the server is the only source of reach/attack/
 * heal truth; the bot merely pairs a proposing destination with an action.
 */
async function buildBundle(api: APIRequestContext, meta: Meta, game: GameState): Promise<Move[]> {
  const enemies = game.units.filter((u) => u.side === "enemy");
  const allies = game.units.filter((u) => u.side === "player");
  const moves: Move[] = [];
  // Landing-tile rule (06 endpoint 13): no stacks, no chain-following. The
  // bot refuses to land on ANY ally's pre-move tile and on tiles an earlier
  // entry already claimed — the strictest reading, immune to order effects.
  const forbidden = new Set<string>(allies.map((u) => key(u.x, u.y)));
  // Deterministic combat accounting (02): staged damage resolves exactly and
  // in bundle order — a target an earlier entry already kills must not be
  // attacked again, or the later entry's target is gone ("not a valid attack
  // target") and the WHOLE bundle is rejected.
  const stagedEnemyDamage = new Map<string, number>();
  // Where each already-staged ally WILL stand when the healer's entry runs.
  const stagedAllyFinal = new Map<string, [number, number]>();
  // The healer must run LAST: heal adjacency is checked against the state
  // after every earlier entry, so all allies' landing tiles are known.
  const alliesInOrder = [
    ...allies.filter((unit) => unit.class !== "healer"),
    ...allies.filter((unit) => unit.class === "healer"),
  ];

  for (const unit of alliesInOrder) {
    const preview = await getPreview(api, game.id, unit.id);
    const classMeta = meta.classes[unit.class];
    const free = (tile: [number, number]): boolean => !forbidden.has(key(tile[0], tile[1]));

    // 1) attacks — prefer a no-counter pair, then damage; a counter that
    //    would kill the attacker is never staged.
    let best: (AttackPair & { score: number }) | null = null;
    for (const dest of preview.moveTiles) {
      if (!free(dest)) {
        continue;
      }
      for (const target of enemies) {
        const distance = manhattan(dest[0], dest[1], target.x, target.y);
        if (!classMeta.range.includes(distance)) {
          continue;
        }
        const damage = Math.max(0, classMeta.atk - meta.classes[target.class].def);
        const alreadyStaged = stagedEnemyDamage.get(target.id) ?? 0;
        // Only the FIRST attacker of a target may kill it inside the bundle.
        if (alreadyStaged > 0 && alreadyStaged + damage >= target.hp) {
          continue;
        }
        const targetRange = meta.classes[target.class].range;
        const counterDamage =
          targetRange.includes(distance) && meta.classes[target.class].atk > 0
            ? Math.max(0, meta.classes[target.class].atk - classMeta.def)
            : 0;
        if (counterDamage >= unit.hp) {
          continue; // never commit suicide through a counter
        }
        const score =
          (counterDamage === 0 ? 1000 : 0) +
          2 * damage -
          4 * counterDamage -
          (target.hp - (alreadyStaged + damage)) / 10; // nearly-dead first
        if (
          best === null ||
          score > best.score ||
          (score === best.score &&
            (key(dest[0], dest[1]) < key(best.dest[0], best.dest[1]) || target.id < best.target.id))
        ) {
          best = { dest, target, damage, counterDamage, score };
        }
      }
    }
    if (best !== null) {
      forbidden.add(key(best.dest[0], best.dest[1]));
      stagedEnemyDamage.set(
        best.target.id,
        (stagedEnemyDamage.get(best.target.id) ?? 0) + best.damage,
      );
      stagedAllyFinal.set(unit.id, best.dest);
      moves.push({
        unitId: unit.id,
        path: walkPath(game, unit, best.dest),
        action: { type: "attack", targetId: best.target.id },
      });
      continue;
    }

    // 2) healer: heal the most wounded ally the preview offers — adjacency
    //    is judged against the ally's EXECUTED tile (its own staged landing
    //    tile if it already moved within this bundle, its tile otherwise).
    if (preview.healTiles.length > 0) {
      const executedTile = (ally: Unit): [number, number] => {
        const final = stagedAllyFinal.get(ally.id);
        return final ?? [ally.x, ally.y];
      };
      const healCandidates = allies
        .filter(
          (ally) =>
            ally.hp < ally.maxHp &&
            preview.healTiles.some((tile) => tile[0] === ally.x && tile[1] === ally.y),
        )
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp);
      for (const wounded of healCandidates) {
        const targetTile = executedTile(wounded);
        const dest = preview.moveTiles.find(
          (tile) => free(tile) && manhattan(tile[0], tile[1], targetTile[0], targetTile[1]) === 1,
        );
        if (dest !== undefined) {
          forbidden.add(key(dest[0], dest[1]));
          stagedAllyFinal.set(unit.id, dest);
          moves.push({
            unitId: unit.id,
            path: walkPath(game, unit, dest),
            action: { type: "heal", targetId: wounded.id },
          });
          break;
        }
      }
      if (moves.some((move) => move.unitId === unit.id)) {
        continue;
      }
    }

    // 3) otherwise close the distance to the nearest enemy (small steps are
    //    fine — the standalone mock only watches them approach).
    const movable = preview.moveTiles.filter(free).sort((a, b) => {
      const da = Math.min(...enemies.map((e) => manhattan(a[0], a[1], e.x, e.y)));
      const db = Math.min(...enemies.map((e) => manhattan(b[0], b[1], e.x, e.y)));
      if (da !== db) {
        return da - db;
      }
      return key(a[0], a[1]) < key(b[0], b[1]) ? -1 : 1;
    });
    if (movable.length > 0) {
      const dest = movable[0] as [number, number];
      forbidden.add(key(dest[0], dest[1]));
      stagedAllyFinal.set(unit.id, dest);
      moves.push({
        unitId: unit.id,
        path: walkPath(game, unit, dest),
        action: { type: "wait" },
      });
    }
    // fully boxed: omit the unit — omission is explicitly legal (06)
  }
  return moves;
}

async function waitForRoundEnd(
  api: APIRequestContext,
  gameId: string,
  budgetMs = 30_000,
): Promise<GameState> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const game = await getGame(api, gameId);
    if (game.status !== "ai_turn") {
      return game;
    }
    if (Date.now() > deadline) {
      throw new Error(`e2e play-bot: AI turn did not settle (${gameId})`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

export interface BotResult {
  game: GameState;
  rounds: number;
}

/**
 * Plays the given game to victory via the contract endpoints. Throws on a
 * loss (must be impossible against the standalone mock — it never attacks),
 * on a rejected bundle (server authority — fail loudly), or if the round
 * budget is exhausted.
 */
export async function playUntilWin(
  api: APIRequestContext,
  gameId: string,
  maxRounds = 200,
): Promise<BotResult> {
  const meta = await getMeta(api);
  let game = await getGame(api, gameId);
  if (game.status !== "player_turn") {
    throw new Error(`e2e play-bot: game ${gameId} already ${game.status}`);
  }
  for (let round = 1; game.status === "player_turn"; round++) {
    if (round > maxRounds) {
      throw new Error(
        `e2e play-bot: no victory in ${maxRounds} rounds (last status ${game.status})`,
      );
    }
    const moves = await buildBundle(api, meta, game);
    const applied = await postMoves(api, game.id, moves);
    if (applied.status === "won") {
      return { game: applied, rounds: round };
    }
    await endTurn(api, game.id);
    game = await waitForRoundEnd(api, game.id);
    if (game.status === "lost") {
      throw new Error(`e2e play-bot: army wiped on round ${round}`);
    }
  }
  throw new Error(`e2e play-bot: unexpected status ${game.status}`);
}
