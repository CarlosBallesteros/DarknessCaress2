import { Router } from "express";
import type { Pool } from "pg";
import type { AppConfig } from "../../config/index.js";
import type { AuthenticatedRequest } from "../auth/requireAuth.js";
import { wrapAsync } from "../wrapAsync.js";

export function createStatsRouter(
  pool: Pool,
  config: AppConfig,
  requireAuth: ReturnType<typeof import("../auth/requireAuth.js").createRequireAuth>,
): Router {
  const router = Router();

  router.get(
    "/stats",
    requireAuth,
    wrapAsync(async (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.user.id;

      // Only finished games count (won/lost)
      const rows = await pool.query<{ difficulty: string; status: string; count: string }>(
        `SELECT difficulty, status, COUNT(*)::text AS count
         FROM games
         WHERE user_id = $1 AND status IN ('won', 'lost')
         GROUP BY difficulty, status`,
        [userId],
      );

      const byDifficultyMap = new Map<string, { played: number; wins: number; losses: number }>();
      for (const key of Object.keys(config.personalities)) {
        byDifficultyMap.set(key, { played: 0, wins: 0, losses: 0 });
      }

      let wins = 0;
      let losses = 0;

      for (const row of rows.rows) {
        const diff = row.difficulty;
        const count = Number(row.count);
        if (!byDifficultyMap.has(diff)) {
          // include rows even if difficulty not in config? config-driven table should have one row per persona in config
          // but finished games might exist with unknown difficulty - still count in totals; byDifficulty lists personas in config.
        }
        const entry = byDifficultyMap.get(diff);
        if (row.status === "won") {
          wins += count;
          if (entry) {
            entry.wins += count;
            entry.played += count;
          }
        } else if (row.status === "lost") {
          losses += count;
          if (entry) {
            entry.losses += count;
            entry.played += count;
          }
        }
      }

      const gamesPlayed = wins + losses;
      const winRate = gamesPlayed === 0 ? 0 : wins / gamesPlayed;

      const byDifficulty = Object.keys(config.personalities).map((difficulty) => {
        const entry = byDifficultyMap.get(difficulty) ?? { played: 0, wins: 0, losses: 0 };
        return { difficulty, played: entry.played, wins: entry.wins, losses: entry.losses };
      });

      res.status(200).json({ gamesPlayed, wins, losses, winRate, byDifficulty });
    }),
  );

  return router;
}
