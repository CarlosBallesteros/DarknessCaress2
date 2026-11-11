// GET /api/stats (docs/06 endpoint 8) — the Statistics tab data, computed
// from FINISHED game rows only (there is no separate history table): games
// in flight (generating_board / player_turn / ai_turn) are excluded.
// `byDifficulty` ALWAYS contains one row per persona in config — zeros
// included, a stable table.
import { Router } from "express";
import { config } from "../../config/load";
import { pool } from "../../db/pool";
import { wrapAsync } from "../../wrapAsync";
import { requireAuth } from "../auth/requireAuth";

export const statsRouter = Router();

statsRouter.get(
  "/stats",
  requireAuth,
  wrapAsync(async (req, res) => {
    const { rows } = await pool.query<{
      difficulty: string;
      played: number;
      wins: number;
      losses: number;
    }>(
      `SELECT difficulty,
              COUNT(*)::int AS played,
              COUNT(*) FILTER (WHERE status = 'won')::int AS wins,
              COUNT(*) FILTER (WHERE status = 'lost')::int AS losses
       FROM games
       WHERE user_id = $1 AND status IN ('won', 'lost')
       GROUP BY difficulty`,
      [req.user!.id],
    );

    const byDifficulty = Object.keys(config.personalities).map((difficulty) => {
      const row = rows.find((candidate) => candidate.difficulty === difficulty);
      return {
        difficulty,
        played: row?.played ?? 0,
        wins: row?.wins ?? 0,
        losses: row?.losses ?? 0,
      };
    });

    const gamesPlayed = byDifficulty.reduce((sum, row) => sum + row.played, 0);
    const wins = byDifficulty.reduce((sum, row) => sum + row.wins, 0);
    const losses = byDifficulty.reduce((sum, row) => sum + row.losses, 0);
    // docs/06's example renders 7/12 as 0.583 — three decimals; floored to 0
    // when nothing is finished (never NaN/null/omitted).
    const winRate = gamesPlayed === 0 ? 0 : Math.round((wins / gamesPlayed) * 1000) / 1000;

    res.status(200).json({ gamesPlayed, wins, losses, winRate, byDifficulty });
  }),
);
