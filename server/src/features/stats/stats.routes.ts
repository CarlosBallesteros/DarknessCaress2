// Endpoint 8 of docs/06: statistics computed from finished game rows.
// byDifficulty ALWAYS carries one row per persona in config, in config-key
// order (zeros included — a stable table); winRate is floored to 0 when there
// are no finished games (never NaN/null/omitted).
import { Router } from "express";
import { config } from "../../config/config";
import { requireAuth } from "../auth/require-auth";
import { wrapAsync } from "../../wrap-async";
import { finishedCountsByUser } from "./stats.repo";

export const statsRouter = Router();

statsRouter.get(
  "/",
  requireAuth,
  wrapAsync(async (req, res) => {
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
    // docs/06's example (7/12 → 0.583) renders at three decimals, floored.
    const winRate =
      gamesPlayed === 0 ? 0 : Math.floor((wins / gamesPlayed) * 1000) / 1000;
    res.status(200).json({ gamesPlayed, wins, losses, winRate, byDifficulty });
  }),
);
