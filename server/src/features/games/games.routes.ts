// Games endpoints (docs/06). Phase 4 (docs/09) ships endpoint 10 — game
// creation with the full board-generation pipeline; the remaining games
// endpoints arrive with phase 5.
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { config } from "../../config/config";
import { engineConfig } from "../../game/engine-config";
import { HttpError, parseBody } from "../../http-error";
import { wrapAsync } from "../../wrap-async";
import { getLlmClient } from "../ai/llmClient";
import { briefPrompt } from "../board/brief-prompt";
import { generateBoard, BoardGenerationError } from "../board/generate";
import { assembleArmies } from "../board/spawn";
import { hashUuidToSeed } from "../board/prng";
import { requireAuth } from "../auth/require-auth";
import { createGameSchema } from "./games.schema";
import { countActiveGames, insertGame, toGameStateDto } from "./games.repo";

export const gamesRouter = Router();

// 10. POST /api/games — capability checks first (auth ✓, difficulty ✓, cap ✓,
// fail fast before any generation), then the synchronous board generation
// (~10-60 s live), army assembly from config counts, insert with
// status=player_turn / turnNumber=1, used_fallback recorded when the fallback
// template fired.
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
      throw new HttpError(
        409,
        `Active game limit reached (${config.maxActiveGames})`,
      );
    }

    // The game's uuid is created here and hashed once into the generation
    // seed (docs/03) — the row carries the same uuid as its primary key.
    const gameId = randomUUID();
    const seed = hashUuidToSeed(gameId);

    let board;
    let usedFallback: boolean;
    try {
      const generated = await generateBoard(seed, {
        briefSource: () => getLlmClient().brief({ user: briefPrompt() }),
      });
      board = generated.board;
      usedFallback = generated.usedFallback;
    } catch (error) {
      if (error instanceof BoardGenerationError) {
        throw new HttpError(503, "Battlefield generation failed, try again");
      }
      throw error;
    }

    const row = await insertGame({
      id: gameId,
      userId,
      difficulty: input.difficulty,
      board,
      units: assembleArmies(seed, engineConfig),
      usedFallback,
    });

    res.status(201).json({ game: toGameStateDto(row) });
  }),
);
