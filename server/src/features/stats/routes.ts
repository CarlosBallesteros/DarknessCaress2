import { Router } from "express";
import { config } from "../../config";
import { pool } from "../../db/pool";
import { requireAuth } from "../auth/middleware";
import { wrapAsync } from "../wrapAsync";
import "../auth/types";

export const statsRouter = Router();

statsRouter.get(
  "/api/stats",
  requireAuth,
  wrapAsync(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const result = await pool.query<{ difficulty: string; status: string }>(
      `SELECT difficulty, status FROM games WHERE user_id = $1 AND status IN ('won','lost')`,
      [user.id],
    );
    const rows = result.rows;
    const by: Record<string, { played: number; wins: number; losses: number }> = {};
    for (const key of Object.keys(config.personalities)) {
      by[key] = { played: 0, wins: 0, losses: 0 };
    }
    let wins = 0;
    let losses = 0;
    for (const r of rows) {
      const d = r.difficulty;
      if (!by[d]) {
        by[d] = { played: 0, wins: 0, losses: 0 };
      }
      by[d].played += 1;
      if (r.status === "won") {
        by[d].wins += 1;
        wins += 1;
      } else if (r.status === "lost") {
        by[d].losses += 1;
        losses += 1;
      }
    }
    const gamesPlayed = wins + losses;
    const winRate = gamesPlayed === 0 ? 0 : wins / gamesPlayed;
    const byDifficulty = Object.keys(config.personalities).map((difficulty) => ({
      difficulty,
      played: by[difficulty]?.played ?? 0,
      wins: by[difficulty]?.wins ?? 0,
      losses: by[difficulty]?.losses ?? 0,
    }));

    res.status(200).json({ gamesPlayed, wins, losses, winRate, byDifficulty });
  }),
);
