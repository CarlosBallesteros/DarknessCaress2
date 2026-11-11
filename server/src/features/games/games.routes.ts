// Games endpoints (docs/06). Endpoint 10 is game creation with the full
// board-generation pipeline (docs/09 phase 4); 9 and 11-15 are the turn flow,
// preview and list (docs/09 phase 5). Every game reference is owned by the
// caller; unknown-or-foreign reads 404 "Not found" — existence is never
// leaked.
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { config } from "../../config/config";
import { engineConfig } from "../../game/engine-config";
import { applyMoves, checkVictory } from "../../game/apply";
import { previewMove } from "../../game/reach";
import { HttpError, parseBody } from "../../http-error";
import { wrapAsync } from "../../wrap-async";
import { getLlmClient } from "../ai/llmClient";
import { retriggerStaleAiTurns, triggerAiTurn } from "../ai/ai-turn";
import { briefPrompt } from "../board/brief-prompt";
import { generateBoard, BoardGenerationError } from "../board/generate";
import { assembleArmies } from "../board/spawn";
import { hashUuidToSeed } from "../board/prng";
import { requireAuth } from "../auth/require-auth";
import { createGameSchema, movesBodySchema } from "./games.schema";
import { failingMoveIndex } from "./move-errors";
import {
  applyPlayerMoves,
  beginAiTurn,
  countActiveGames,
  endTurnWon,
  forfeitGame,
  getGameByUser,
  insertGame,
  listGamesByUser,
  toGameSummaryDto,
  toGameStateDto,
} from "./games.repo";

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

// 9. GET /api/games — creation-ordered summaries, with the MANDATED side
// effect of re-triggering this user's stale AI jobs before reading (docs/01
// stale recovery).
gamesRouter.get(
  "/",
  requireAuth,
  wrapAsync(async (req, res) => {
    await retriggerStaleAiTurns(req.user!.id);
    const rows = await listGamesByUser(req.user!.id);
    res.status(200).json({ games: rows.map(toGameSummaryDto) });
  }),
);

// 11. GET /api/games/:id — full state, stale recovery scoped to this game.
// While ai_turn the response reflects the state at query time — no blocking,
// no long-polling.
gamesRouter.get(
  "/:id",
  requireAuth,
  wrapAsync(async (req, res) => {
    await retriggerStaleAiTurns(req.user!.id, req.params.id);
    const row = await getGameByUser(req.user!.id, req.params.id);
    if (row === undefined) {
      throw new HttpError(404, "Not found");
    }
    res.status(200).json({ game: toGameStateDto(row) });
  }),
);

// 12. GET /api/games/:id/preview/:unitId — tiles only, computed by the same
// engine code that validates submitted bundles. unitId may be ANY unit in the
// game: own units stage (already-acted excluded), enemy units are read-only
// inspection — the "side" field tells the client which mode to render.
gamesRouter.get(
  "/:id/preview/:unitId",
  requireAuth,
  wrapAsync(async (req, res) => {
    const row = await getGameByUser(req.user!.id, req.params.id);
    if (row === undefined) {
      throw new HttpError(404, "Not found");
    }
    if (row.status !== "player_turn") {
      throw new HttpError(409, "Game is not waiting for your turn");
    }
    const unit = row.units.find(
      (candidate) => candidate.id === req.params.unitId,
    );
    // "Unit not playable" covers unknown and already-acted OWN ids alike —
    // it leaks nothing about which.
    if (unit === undefined || (unit.side === "player" && unit.acted)) {
      throw new HttpError(404, "Unit not playable");
    }
    const preview = previewMove(row.board, row.units, unit, engineConfig);
    res.status(200).json({ ...preview, side: unit.side });
  }),
);

// 13. POST /api/games/:id/moves — validates & applies the whole player turn
// atomically. Exactly ONE successful submission per round: the schema-borne
// lock (games.moves_applied) is set by every APPLIED bundle, empty ones
// included; FAILED attempts apply nothing and do not consume the budget.
gamesRouter.post(
  "/:id/moves",
  requireAuth,
  wrapAsync(async (req, res) => {
    const input = parseBody(movesBodySchema, req.body);
    const row = await getGameByUser(req.user!.id, req.params.id);
    if (row === undefined) {
      throw new HttpError(404, "Not found");
    }
    if (row.status !== "player_turn") {
      throw new HttpError(409, "Game is not waiting for your turn");
    }
    if (row.moves_applied) {
      throw new HttpError(409, "Turn moves already submitted");
    }

    const state = { board: row.board, units: row.units };
    const applied = applyMoves(state, input.moves, "player", engineConfig);
    if (!applied.ok) {
      // The errored move's 1-based index in the "move N:" prefix (docs/06).
      const index = failingMoveIndex(
        state,
        input.moves,
        applied.error,
        engineConfig,
      );
      throw new HttpError(400, `move ${index}: ${applied.error}`);
    }
    // Victory short-circuit: all enemies wiped by these moves ⇒ won directly,
    // no /end-turn may follow (docs/06's matrix has no player_turn → ai_turn
    // from here).
    const status =
      checkVictory(applied.result.state.units) === "player"
        ? "won"
        : "player_turn";
    const updated = await applyPlayerMoves(
      req.params.id,
      applied.result.state.units,
      status,
    );
    if (updated === undefined) {
      // A concurrent submission applied first — answer per the re-read state.
      const fresh = await getGameByUser(req.user!.id, req.params.id);
      if (fresh === undefined || fresh.status !== "player_turn") {
        throw new HttpError(409, "Game is not waiting for your turn");
      }
      throw new HttpError(409, "Turn moves already submitted");
    }
    res.status(200).json({ game: toGameStateDto(updated) });
  }),
);

// 14. POST /api/games/:id/end-turn — pure state transition into the AI turn,
// then the fire-and-forget job (docs/01). No prior /moves is required;
// un-acted units simply do nothing. turnNumber stays — it advances only when
// a successful AI turn completes.
gamesRouter.post(
  "/:id/end-turn",
  requireAuth,
  wrapAsync(async (req, res) => {
    const row = await getGameByUser(req.user!.id, req.params.id);
    if (row === undefined) {
      throw new HttpError(404, "Not found");
    }
    if (row.status !== "player_turn") {
      throw new HttpError(409, "Game is not waiting for your turn");
    }
    // Victory check before scheduling: all enemies dead ⇒ won, no AI turn.
    if (checkVictory(row.units) === "player") {
      const won = await endTurnWon(req.params.id);
      if (won === undefined) {
        throw new HttpError(409, "Game is not waiting for your turn");
      }
      res.status(200).json({ game: toGameStateDto(won) });
      return;
    }
    // The acted reset covers BOTH armies in one stroke (docs/06 endpoint 14).
    const resetUnits = row.units.map((unit) => ({ ...unit, acted: false }));
    const updated = await beginAiTurn(req.params.id, resetUnits);
    if (updated === undefined) {
      throw new HttpError(409, "Game is not waiting for your turn");
    }
    triggerAiTurn(req.params.id);
    res.status(200).json({ game: toGameStateDto(updated) });
  }),
);

// 15. POST /api/games/:id/forfeit — concede from either active status; only
// the first flip counts, and a finished game rejects.
gamesRouter.post(
  "/:id/forfeit",
  requireAuth,
  wrapAsync(async (req, res) => {
    const row = await getGameByUser(req.user!.id, req.params.id);
    if (row === undefined) {
      throw new HttpError(404, "Not found");
    }
    if (row.status === "won" || row.status === "lost") {
      throw new HttpError(409, "Game already finished");
    }
    const updated = await forfeitGame(req.params.id);
    if (updated === undefined) {
      throw new HttpError(409, "Game already finished");
    }
    res.status(200).json({ game: toGameStateDto(updated) });
  }),
);
