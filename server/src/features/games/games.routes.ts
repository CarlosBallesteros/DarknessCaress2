import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getConfig } from "../../config/config.js";
import { parseBody } from "../../parse-body.js";
import { wrapAsync } from "../../wrap-async.js";
import { createLlmClient } from "../ai/llmClient.js";
import {
  BoardGenerationError,
  generateGame,
  seedFromGameId,
} from "../board/generate.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { toGameDTO } from "./game.dto.js";
import { countActiveGames, insertGame } from "./games.queries.js";

const createGameSchema = z.object({
  difficulty: z.string(),
});

export const gamesRouter = Router();

// Endpoint 10 of 06: capability checks fail fast (auth → difficulty → cap),
// only then runs the synchronous board generation (may take ~10-60 s live).
gamesRouter.post(
  "/games",
  requireAuth,
  wrapAsync(async (req, res) => {
    const body = parseBody(createGameSchema, req.body, res);
    if (!body) return;
    const config = getConfig();

    if (!(body.difficulty in config.personalities)) {
      res.status(400).json({ error: "Unknown difficulty" });
      return;
    }
    const active = await countActiveGames(req.user!.id);
    if (active >= config.maxActiveGames) {
      res.status(409).json({
        error: `Active game limit reached (${config.maxActiveGames})`,
      });
      return;
    }

    // The game's uuid is hashed once into the board seed (03) and becomes the
    // row id — board generation happens before insert (01 schema note).
    const id = randomUUID();
    try {
      const generated = await generateGame({
        seed: seedFromGameId(id),
        llm: createLlmClient(),
        config,
      });
      const row = await insertGame({
        id,
        userId: req.user!.id,
        difficulty: body.difficulty,
        board: generated.board,
        units: generated.units,
        usedFallback: generated.usedFallback,
      });
      res.status(201).json({ game: toGameDTO(row) });
    } catch (err) {
      if (err instanceof BoardGenerationError) {
        res
          .status(503)
          .json({ error: "Battlefield generation failed, try again" });
        return;
      }
      throw err;
    }
  }),
);
