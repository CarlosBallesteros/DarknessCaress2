import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getConfig, toEngineConfig } from "../../config/config.js";
import { parseBody } from "../../parse-body.js";
import { wrapAsync } from "../../wrap-async.js";
import { applyMoves, checkVictory } from "../../game/apply.js";
import { previewMove } from "../../game/reach.js";
import { createLlmClient } from "../ai/llmClient.js";
import { retriggerStaleAiTurns, triggerAiTurn } from "../ai/aiTurn.js";
import {
  BoardGenerationError,
  generateGame,
  seedFromGameId,
} from "../board/generate.js";
import { requireAuth } from "../auth/auth.middleware.js";
import { toGameDTO, toGameSummary } from "./game.dto.js";
import { failingMoveIndex } from "./move-errors.js";
import { movesBodySchema } from "./movesSchema.js";
import {
  applyPlayerMoves,
  beginAiTurn,
  countActiveGames,
  endTurnWon,
  forfeitGame,
  getGameByUser,
  insertGame,
  listGamesByUser,
} from "./games.queries.js";

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

// Endpoint 9 of 06: creation-ordered list, with the MANDATED side effect of
// re-triggering this user's stale AI jobs before reading (01 stale recovery).
gamesRouter.get(
  "/games",
  requireAuth,
  wrapAsync(async (req, res) => {
    await retriggerStaleAiTurns(req.user!.id);
    const rows = await listGamesByUser(req.user!.id);
    res.status(200).json({ games: rows.map(toGameSummary) });
  }),
);

// Endpoint 11 of 06: full game state, stale recovery scoped to this game. The
// response reflects the state at query time — no blocking, no long-polling.
gamesRouter.get(
  "/games/:id",
  requireAuth,
  wrapAsync(async (req, res) => {
    await retriggerStaleAiTurns(req.user!.id, req.params.id);
    const row = await getGameByUser(req.user!.id, req.params.id);
    if (row === undefined) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(200).json({ game: toGameDTO(row) });
  }),
);

// Endpoint 12 of 06: move/action preview for one playable player unit — tiles
// only, computed by the same engine code that validates submitted bundles.
gamesRouter.get(
  "/games/:id/preview/:unitId",
  requireAuth,
  wrapAsync(async (req, res) => {
    const row = await getGameByUser(req.user!.id, req.params.id);
    if (row === undefined) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (row.status !== "player_turn") {
      res.status(409).json({ error: "Game is not waiting for your turn" });
      return;
    }
    const unit = row.units.find(
      (candidate) => candidate.id === req.params.unitId,
    );
    // "Unit not playable" covers unknown, foreign and already-acted ids alike.
    if (unit === undefined || unit.side !== "player" || unit.acted) {
      res.status(404).json({ error: "Unit not playable" });
      return;
    }
    const preview = previewMove(
      row.board,
      row.units,
      unit,
      toEngineConfig(getConfig()),
    );
    res.status(200).json(preview);
  }),
);

// Endpoint 13 of 06: validates & applies the whole player turn atomically.
gamesRouter.post(
  "/games/:id/moves",
  requireAuth,
  wrapAsync(async (req, res) => {
    const body = parseBody(movesBodySchema, req.body, res);
    if (!body) return;
    const row = await getGameByUser(req.user!.id, req.params.id);
    if (row === undefined) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (row.status !== "player_turn") {
      res.status(409).json({ error: "Game is not waiting for your turn" });
      return;
    }
    // Exactly ONE successful submission per round — the schema-borne lock set
    // by every APPLIED bundle, empty ones included (06 ep. 13 / 01).
    if (row.moves_applied) {
      res.status(409).json({ error: "Turn moves already submitted" });
      return;
    }

    const config = getConfig();
    const engineCfg = toEngineConfig(config);
    const state = { board: row.board, units: row.units };
    const applied = applyMoves(state, body.moves, "player", engineCfg);
    if (!applied.ok) {
      // Failed attempts apply NOTHING and do not consume the round's budget.
      const index = failingMoveIndex(
        state,
        body.moves,
        applied.error,
        engineCfg,
      );
      res.status(400).json({ error: `move ${index}: ${applied.error}` });
      return;
    }
    const victory = checkVictory(applied.result.state.units);
    const status =
      victory === "player"
        ? "won"
        : victory === "enemy"
          ? "lost"
          : "player_turn";
    const updated = await applyPlayerMoves(
      req.params.id,
      applied.result.state.units,
      status,
    );
    if (updated === undefined) {
      // A concurrent submission applied first — answer per the re-read state.
      const fresh = await getGameByUser(req.user!.id, req.params.id);
      if (fresh !== undefined && fresh.status !== "player_turn") {
        res.status(409).json({ error: "Game is not waiting for your turn" });
      } else {
        res.status(409).json({ error: "Turn moves already submitted" });
      }
      return;
    }
    res.status(200).json({ game: toGameDTO(updated) });
  }),
);

// Endpoint 14 of 06: pure state transition into the AI turn, then the
// fire-and-forget job (01). No prior /moves is required; un-acted units do
// nothing. turnNumber stays — it advances only on a successful AI turn.
gamesRouter.post(
  "/games/:id/end-turn",
  requireAuth,
  wrapAsync(async (req, res) => {
    const row = await getGameByUser(req.user!.id, req.params.id);
    if (row === undefined) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (row.status !== "player_turn") {
      res.status(409).json({ error: "Game is not waiting for your turn" });
      return;
    }
    // Victory check before scheduling: all enemies dead ⇒ won, no AI turn.
    if (checkVictory(row.units) === "player") {
      const won = await endTurnWon(req.params.id);
      if (won === undefined) {
        res.status(409).json({ error: "Game is not waiting for your turn" });
        return;
      }
      res.status(200).json({ game: toGameDTO(won) });
      return;
    }
    // The acted reset covers BOTH armies in one stroke (06 ep. 14).
    const resetUnits = row.units.map((unit) => ({ ...unit, acted: false }));
    const updated = await beginAiTurn(req.params.id, resetUnits);
    if (updated === undefined) {
      res.status(409).json({ error: "Game is not waiting for your turn" });
      return;
    }
    triggerAiTurn(req.params.id);
    res.status(200).json({ game: toGameDTO(updated) });
  }),
);

// Endpoint 15 of 06: concede from either active status; repeat forfeits on a
// finished game are rejected, on an ACTIVE game harmless (only the first flip counts).
gamesRouter.post(
  "/games/:id/forfeit",
  requireAuth,
  wrapAsync(async (req, res) => {
    const row = await getGameByUser(req.user!.id, req.params.id);
    if (row === undefined) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (row.status === "won" || row.status === "lost") {
      res.status(409).json({ error: "Game already finished" });
      return;
    }
    const updated = await forfeitGame(req.params.id);
    if (updated === undefined) {
      res.status(409).json({ error: "Game already finished" });
      return;
    }
    res.status(200).json({ game: toGameDTO(updated) });
  }),
);
