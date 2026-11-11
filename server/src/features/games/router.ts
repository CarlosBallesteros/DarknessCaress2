// Games endpoints (docs/06). Phase 4 shipped endpoint 10 — game creation
// with ASYNC board generation — and endpoint 11. Phase 5 adds the rest of
// the turn surface: the games list (9), preview (12), moves (13), end-turn
// (14) and forfeit (15). Every game reference is owned by the caller;
// unknown-or-foreign reads 404 "Not found" — existence is never leaked.
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { engineConfig } from "../../config/engine";
import { config } from "../../config/load";
import { applyMoves, checkVictory } from "../../game/apply";
import { previewMove } from "../../game/reach";
import type { Move } from "../../game/types";
import { HttpError } from "../../httpError";
import { parseBody } from "../../validation";
import { wrapAsync } from "../../wrapAsync";
import { requireAuth } from "../auth/requireAuth";
import { runAiTurn } from "../ai/aiTurn";
import { retriggerStaleJobs, startGameJob, runBoardDesignJob } from "./jobs";
import { failedMoveIndex } from "./moveIndex";
import { createGameSchema, movesRequestSchema } from "./schema";
import {
  countActiveGames,
  getGameByUser,
  insertGeneratingGame,
  listGamesByUser,
  resetActedFlags,
  toGameSummaryDto,
  toGameStateDto,
  updateTurnState,
  withGameRowLock,
} from "./repo";

export const gamesRouter = Router();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 9. GET /api/games — the games strip, ordered by creation order
// (`created_at` ascending — position is the player's mental map, never
// reshuffled). Includes generating_board rows ("being designed…" mini-maps).
// Side effect (mandated): before reading, re-trigger stale jobs for this
// user (docs/01 stale recovery — both job kinds).
gamesRouter.get(
  "/",
  requireAuth,
  wrapAsync(async (req, res) => {
    await retriggerStaleJobs(req.user!.id);
    const rows = await listGamesByUser(req.user!.id);
    res.status(200).json({ games: rows.map(toGameSummaryDto) });
  }),
);

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
// scoped to this game — covering BOTH ai_turn games and generating_board rows
// whose design job stalled). While generating_board or ai_turn the response
// reflects the state at query time — no blocking, no long-polling (docs/06).
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

// 12. GET /api/games/:id/preview/:unitId — any unit id belonging to THIS
// game, only while player_turn. Own units = staging preview (already-acted
// own units excluded); ENEMY units = read-only inspection preview, never
// staged. "Unit not playable" covers unknown-or-foreign unit ids without
// revealing which (docs/06).
gamesRouter.get(
  "/:id/preview/:unitId",
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = req.params.id;
    if (!UUID_PATTERN.test(id)) {
      throw new HttpError(404, "Not found");
    }
    const row = await getGameByUser(req.user!.id, id);
    if (row === undefined) {
      throw new HttpError(404, "Not found");
    }
    if (row.status !== "player_turn") {
      throw new HttpError(409, "Game is not waiting for your turn");
    }
    const unit = row.units.find((candidate) => candidate.id === req.params.unitId);
    if (unit === undefined || (unit.side === "player" && unit.acted)) {
      throw new HttpError(404, "Unit not playable");
    }
    // Same src/game source as moves validation — the preview can never
    // disagree with the engine. Tiles only, no paths (docs/06).
    const preview = previewMove(row.board, row.units, unit, engineConfig);
    res.status(200).json({ ...preview, side: unit.side });
  }),
);

// 13. POST /api/games/:id/moves — validates & applies the whole player turn
// atomically (single transaction, row-locked). Exactly ONE *successful*
// submission per round: the persisted `games.moves_applied` lock (set by
// every applied bundle — an empty one included — reset by /end-turn) is
// restart-proof; FAILED attempts leave the round unlocked. The engine
// validates entry-by-entry against the evolving state (chain-following is
// legal in bundle order); any failing entry rejects the whole bundle with
// the exact engine message under a "move N:" 1-based prefix.
gamesRouter.post(
  "/:id/moves",
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = req.params.id;
    if (!UUID_PATTERN.test(id)) {
      throw new HttpError(404, "Not found");
    }
    const input = parseBody(movesRequestSchema, req.body);
    const moves = input.moves as Move[];
    const row = await withGameRowLock(req.user!.id, id, async (game, client) => {
      if (game.status !== "player_turn") {
        throw new HttpError(409, "Game is not waiting for your turn");
      }
      if (game.moves_applied) {
        throw new HttpError(409, "Turn moves already submitted");
      }
      const applied = applyMoves(
        { board: game.board, units: game.units },
        moves,
        "player",
        engineConfig,
      );
      if (!applied.ok) {
        const index = failedMoveIndex(
          { board: game.board, units: game.units },
          moves,
          applied.error,
        );
        throw new HttpError(400, `move ${index}: ${applied.error}`);
      }
      // Victory short-circuit: all enemies wiped by these moves ⇒ won
      // directly; no /end-turn may follow (docs/06 status matrix).
      const status = checkVictory(applied.result.state.units) === "player" ? "won" : "player_turn";
      return updateTurnState(client, game.id, {
        status,
        units: applied.result.state.units,
        movesApplied: true,
      });
    });
    if (row === null) {
      throw new HttpError(404, "Not found");
    }
    res.status(200).json({ game: toGameStateDto(row) });
  }),
);

// 14. POST /api/games/:id/end-turn — only from player_turn; no prior /moves
// is required (skipping submission is legal; un-acted units do nothing).
// Pure state transition: status ai_turn, both sides' acted flags reset, the
// round lock released, turn_number unchanged (it advances only when a
// successful AI turn completes). Victory check first: all enemies dead ⇒ won
// directly, no AI turn. The AI job runs fire-and-forget (docs/01).
gamesRouter.post(
  "/:id/end-turn",
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = req.params.id;
    if (!UUID_PATTERN.test(id)) {
      throw new HttpError(404, "Not found");
    }
    let scheduled = false;
    const row = await withGameRowLock(req.user!.id, id, async (game, client) => {
      if (game.status !== "player_turn") {
        throw new HttpError(409, "Game is not waiting for your turn");
      }
      const status = checkVictory(game.units) === "player" ? "won" : "ai_turn";
      const updated = await updateTurnState(client, game.id, {
        status,
        units: resetActedFlags(game.units),
        movesApplied: false,
      });
      scheduled = status === "ai_turn";
      return updated;
    });
    if (row === null) {
      throw new HttpError(404, "Not found");
    }
    if (scheduled) {
      startGameJob(id, runAiTurn);
    }
    res.status(200).json({ game: toGameStateDto(row) });
  }),
);

// 15. POST /api/games/:id/forfeit — any ACTIVE game is forfeitable (a
// forever-designing game is un-stuck exactly this way). An in-flight
// background job (AI turn or board design) writes its result under the same
// conditional-persist guard, so a forfeit's lost always stands. No
// idempotent success on finished games (docs/06).
gamesRouter.post(
  "/:id/forfeit",
  requireAuth,
  wrapAsync(async (req, res) => {
    const id = req.params.id;
    if (!UUID_PATTERN.test(id)) {
      throw new HttpError(404, "Not found");
    }
    const row = await withGameRowLock(req.user!.id, id, async (game, client) => {
      if (game.status === "won" || game.status === "lost") {
        throw new HttpError(409, "Game already finished");
      }
      return updateTurnState(client, game.id, { status: "lost" });
    });
    if (row === null) {
      throw new HttpError(404, "Not found");
    }
    res.status(200).json({ game: toGameStateDto(row) });
  }),
);
