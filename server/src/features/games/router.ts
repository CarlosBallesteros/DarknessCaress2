// Games endpoints (docs/06). Phase 4 ships endpoint 10 — game creation with
// ASYNC board generation (docs/09 phase 4's v2/v3 amendment): capability
// checks first, then the generating_board insert, then 202 immediately while
// the background job designs the battlefield. GET /:id ships too — the
// phase-4 acceptance flow reads the designed board through it — with its
// contract-mandated stale-recovery side effect; endpoints 9 and 12-15 are
// phase 5. Every game reference is owned by the caller; unknown-or-foreign
// reads 404 "Not found" — existence is never leaked.
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { config } from "../../config/load";
import { HttpError } from "../../httpError";
import { parseBody } from "../../validation";
import { wrapAsync } from "../../wrapAsync";
import { requireAuth } from "../auth/requireAuth";
import { retriggerStaleJobs, startGameJob, runBoardDesignJob } from "./jobs";
import { createGameSchema } from "./schema";
import { countActiveGames, getGameByUser, insertGeneratingGame, toGameStateDto } from "./repo";

export const gamesRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 10. POST /api/games — capability checks first (auth ✓, difficulty ✓, cap ✓ —
// fail fast before anything else), then the row is inserted as
// generating_board with an all-plain placeholder board and empty armies, and
// the request answers 202 immediately; the board-design job runs
// fire-and-forget on the shared job mechanism (docs/01).
gamesRouter.post(
  "/",
  requireAuth,
  wrapAsync(async (req, res) => {
    const input = parseBody(createGameSchema, req.body);
    if (!(input.difficulty in config.personalities)) {
      throw new HttpError(400, "Unknown difficulty");
    }
    const userId = req.user!.id;
    if ((await countActiveGames(userId)) >= config.maxActiveGames) {
      throw new HttpError(409, `Active game limit reached (${config.maxActiveGames})`);
    }

    // The game's uuid is created here and hashed once into the generation
    // seed (docs/03) — the row carries the same uuid as its primary key.
    const gameId = randomUUID();
    const row = await insertGeneratingGame({
      id: gameId,
      userId,
      difficulty: input.difficulty,
    });
    startGameJob(gameId, runBoardDesignJob);

    res.status(202).json({ game: toGameStateDto(row) });
  }),
);

// 11. GET /api/games/:id — full state (stale-recovery side effect as in 9,
// scoped to this game — covering generating_board rows whose design job
// stalled). While generating_board the response reflects the state at query
// time — no blocking, no long-polling (docs/06 endpoint 11).
gamesRouter.get(
  "/:id",
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = req.params.id;
    // A non-uuid path parameter can never belong to the caller — 404 like any
    // other unknown game (and never a 500 from the database).
    if (!UUID_PATTERN.test(id)) {
      throw new HttpError(404, "Not found");
    }
    await retriggerStaleJobs(req.user!.id, id);
    const row = await getGameByUser(req.user!.id, id);
    if (row === undefined) {
      throw new HttpError(404, "Not found");
    }
    res.status(200).json({ game: toGameStateDto(row) });
  }),
);
