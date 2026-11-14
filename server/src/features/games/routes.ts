import { Router } from "express";
import { z } from "zod";
import { config } from "../../config";
import { requireAuth } from "../auth/middleware";
import { parseBody } from "../auth/validation";
import { wrapAsync } from "../wrapAsync";
import { createPlainPlaceholderBoard } from "../board/materialize";
import { countActiveGames, findGameById, insertGeneratingGame } from "./repo";
import { toGameStateDto } from "./dto";
import { kickOffBoardGeneration } from "./boardJob";
import { maybeRecoverStaleJobForGame } from "./staleRecovery";
import "../auth/types";

const createGameSchema = z
  .object({
    difficulty: z.string(),
  })
  .strict();

export const gamesRouter = Router();

gamesRouter.post(
  "/api/games",
  requireAuth,
  wrapAsync(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const body = parseBody(createGameSchema, req.body, res);
    if (!body) return;

    const difficulty = body.difficulty;
    if (!(difficulty in config.personalities)) {
      res.status(400).json({ error: "Unknown difficulty" });
      return;
    }

    const activeCount = await countActiveGames(user.id);
    if (activeCount >= config.maxActiveGames) {
      res.status(409).json({ error: `Active game limit reached (${config.maxActiveGames})` });
      return;
    }

    const placeholderBoard = createPlainPlaceholderBoard(config.boardSize);
    const row = await insertGeneratingGame({
      userId: user.id,
      difficulty,
      board: placeholderBoard,
    });

    res.status(202).json({ game: toGameStateDto(row) });
    kickOffBoardGeneration(row.id);
  }),
);

gamesRouter.get(
  "/api/games/:id",
  requireAuth,
  wrapAsync(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const gameId = req.params.id;
    const row = await findGameById(gameId);
    if (!row || row.user_id !== user.id) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    await maybeRecoverStaleJobForGame(gameId);

    const current = await findGameById(gameId);
    if (!current || current.user_id !== user.id) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    res.status(200).json({ game: toGameStateDto(current) });
  }),
);
