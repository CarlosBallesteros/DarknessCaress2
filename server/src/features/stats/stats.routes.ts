import { Router } from "express";
import { getConfig } from "../../config/config.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { wrapAsync } from "../../wrap-async.js";
import { finishedCountsByUser } from "./stats.queries.js";

export const statsRouter = Router();

// Endpoint 8 of 06: statistics computed from finished game rows. byDifficulty
// ALWAYS carries one row per persona in config, in config-key order (zeros
// included — a stable table).
statsRouter.get(
  "/stats",
  requireAuth,
  wrapAsync(async (req, res) => {
    const config = getConfig();
    const counts = await finishedCountsByUser(req.user!.id);
    const byDifficulty = Object.keys(config.personalities).map((difficulty) => {
      const won =
        counts.find(
          (row) => row.difficulty === difficulty && row.status === "won",
        )?.count ?? 0;
      const lost =
        counts.find(
          (row) => row.difficulty === difficulty && row.status === "lost",
        )?.count ?? 0;
      return { difficulty, played: won + lost, wins: won, losses: lost };
    });
    const wins = byDifficulty.reduce((sum, row) => sum + row.wins, 0);
    const losses = byDifficulty.reduce((sum, row) => sum + row.losses, 0);
    const gamesPlayed = wins + losses;
    // floored to 0 when gamesPlayed = 0 (never NaN/null/omitted); 06's example
    // (7/12 → 0.583) renders at three decimals, floored.
    const winRate =
      gamesPlayed === 0 ? 0 : Math.floor((wins / gamesPlayed) * 1000) / 1000;
    res.status(200).json({ gamesPlayed, wins, losses, winRate, byDifficulty });
  }),
);
