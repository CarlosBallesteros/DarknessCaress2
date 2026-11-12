import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import type { Board, Tile } from "../../game/types.js";
import type { LlmClient } from "../ai/llmClient.js";
import type { AuthenticatedRequest } from "../auth/requireAuth.js";
import { wrapAsync } from "../wrapAsync.js";
import { toGameState } from "./dto.js";
import { runBoardGenerationJob } from "./jobs.js";
import { countActiveGames, findGameByIdForUser, insertGeneratingGame } from "./repo.js";

function firstZodIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Validation error";
}

function makePlaceholderBoard(size: number): Board {
  const tiles: Tile[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => "plain" as Tile),
  );
  return { tiles };
}

export function createGamesRouter(
  pool: Pool,
  config: AppConfig,
  requireAuth: ReturnType<typeof import("../auth/requireAuth.js").createRequireAuth>,
  llm: LlmClient,
): Router {
  const router = Router();

  const createSchema = z
    .object({
      difficulty: z.string(),
    })
    .strict();

  router.post(
    "/games",
    requireAuth,
    wrapAsync(async (req, res) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: firstZodIssue(parsed.error) });
        return;
      }

      const { difficulty } = parsed.data;
      if (!(difficulty in config.personalities)) {
        res.status(400).json({ error: "Unknown difficulty" });
        return;
      }

      const authReq = req as AuthenticatedRequest;
      const activeCount = await countActiveGames(pool, authReq.user.id);
      if (activeCount >= config.maxActiveGames) {
        res.status(409).json({ error: `Active game limit reached (${config.maxActiveGames})` });
        return;
      }

      const placeholder = makePlaceholderBoard(config.boardSize);
      const row = await insertGeneratingGame(pool, authReq.user.id, difficulty, placeholder);

      // fire-and-forget background job; ACTIVE-JOB guard handled inside
      runBoardGenerationJob(pool, config, llm, row.id);

      res.status(202).json({ game: toGameState(row) });
    }),
  );

  // Phase 4: minimal read-only GET /api/games/:id (endpoint 11). Phase 5 completes full contract.
  router.get(
    "/games/:id",
    requireAuth,
    wrapAsync(async (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const { id } = req.params;
      if (!id) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const row = await findGameByIdForUser(pool, id, authReq.user.id);
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      // Minimal phase 4 behavior: return state at query time (no stale-recovery side effects required yet).
      res.status(200).json({ game: toGameState(row) });
    }),
  );

  return router;
}
