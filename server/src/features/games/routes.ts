import { Router } from "express";
import { z } from "zod";
import { config } from "../../config";
import { pool } from "../../db/pool";
import { applyMoves, checkVictory } from "../../game/apply";
import { previewMove } from "../../game/reach";
import type { Board, GameEngineConfig, Move, Side, Unit } from "../../game/types";
import { requireAuth } from "../auth/middleware";
import { parseBody } from "../auth/validation";
import { wrapAsync } from "../wrapAsync";
import { createPlainPlaceholderBoard } from "../board/materialize";
import { kickOffAiTurn } from "../ai/aiTurn";
import { countActiveGames, findGameById, insertGeneratingGame, listGamesByUser } from "./repo";
import { toGameStateDto, toGameSummaryDto } from "./dto";
import { kickOffBoardGeneration } from "./boardJob";
import { maybeRecoverStaleJobForGame, recoverStaleJobsForUser } from "./staleRecovery";
import "../auth/types";

const createGameSchema = z
  .object({
    difficulty: z.string(),
  })
  .strict();

const moveActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("attack"), targetId: z.string() }).strict(),
  z.object({ type: z.literal("heal"), targetId: z.string() }).strict(),
  z.object({ type: z.literal("wait") }).strict(),
]);

const moveSchema = z
  .object({
    unitId: z.string(),
    path: z.array(z.tuple([z.number().int(), z.number().int()])),
    action: moveActionSchema,
  })
  .strict();

const movesBodySchema = z
  .object({
    moves: z.array(moveSchema),
  })
  .strict();

function engineCfg(): GameEngineConfig {
  return {
    boardSize: config.boardSize,
    classes: config.classes as unknown as GameEngineConfig["classes"],
  } as GameEngineConfig;
}

function findMoveErrorIndex(
  state: { board: Board; units: Unit[] },
  moves: Move[],
  side: Side,
  cfg: GameEngineConfig,
): { index: number; message: string } | null {
  for (let i = 0; i < moves.length; i++) {
    const res = applyMoves(state, moves.slice(0, i + 1), side, cfg);
    if (!res.ok) {
      return { index: i, message: res.error };
    }
  }
  return null;
}

export const gamesRouter = Router();

gamesRouter.get(
  "/api/games",
  requireAuth,
  wrapAsync(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    await recoverStaleJobsForUser(user.id);
    const rows = await listGamesByUser(user.id);
    res.status(200).json({ games: rows.map(toGameSummaryDto) });
  }),
);

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

gamesRouter.get(
  "/api/games/:id/preview/:unitId",
  requireAuth,
  wrapAsync(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const gameId = req.params.id;
    const unitId = req.params.unitId;
    const row = await findGameById(gameId);
    if (!row || row.user_id !== user.id) {
      // deliberate: no ownership leak for game
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (row.status !== "player_turn") {
      res.status(409).json({ error: "Game is not waiting for your turn" });
      return;
    }
    const unit = (row.units as Unit[]).find((u) => u.id === unitId);
    if (!unit) {
      res.status(404).json({ error: "Unit not playable" });
      return;
    }
    if (unit.side === "player" && unit.acted) {
      res.status(404).json({ error: "Unit not playable" });
      return;
    }
    const cfg = engineCfg();
    const preview = previewMove(row.board as Board, row.units as Unit[], unit, cfg);
    res.status(200).json({
      moveTiles: preview.moveTiles,
      attackTiles: preview.attackTiles,
      healTiles: preview.healTiles,
      side: unit.side,
    });
  }),
);

gamesRouter.post(
  "/api/games/:id/moves",
  requireAuth,
  wrapAsync(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const body = parseBody(movesBodySchema, req.body, res);
    if (!body) return;

    const gameId = req.params.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT id, user_id, difficulty, status, board, units, turn_number, ai_last_error,
                used_fallback, moves_applied, last_ai_actions, created_at, updated_at
         FROM games WHERE id = $1 FOR UPDATE`,
        [gameId],
      );
      const row = result.rows[0] as import("./dto").GameRow | undefined;
      if (!row || row.user_id !== user.id) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (row.status !== "player_turn") {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Game is not waiting for your turn" });
        return;
      }
      if (row.moves_applied) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Turn moves already submitted" });
        return;
      }

      const cfg = engineCfg();
      const state = { board: row.board as Board, units: (row.units ?? []) as Unit[] };
      const moves = body.moves as unknown as Move[];
      const applied = applyMoves(state, moves, "player", cfg);
      if (!applied.ok) {
        const idxInfo = findMoveErrorIndex(state, moves, "player", cfg);
        await client.query("ROLLBACK");
        if (idxInfo) {
          res.status(400).json({ error: `move ${idxInfo.index + 1}: ${idxInfo.message}` });
        } else {
          res.status(400).json({ error: applied.error });
        }
        return;
      }

      const victory = checkVictory(applied.result.state.units);
      const newStatus = victory === "player" ? "won" : "player_turn";
      const updated = await client.query(
        `UPDATE games
         SET board = $2::jsonb,
             units = $3::jsonb,
             status = $4,
             moves_applied = true,
             updated_at = now()
         WHERE id = $1
         RETURNING id, user_id, difficulty, status, board, units, turn_number, ai_last_error,
                   used_fallback, moves_applied, last_ai_actions, created_at, updated_at`,
        [
          gameId,
          JSON.stringify(applied.result.state.board),
          JSON.stringify(applied.result.state.units),
          newStatus,
        ],
      );
      await client.query("COMMIT");
      const out = updated.rows[0] as import("./dto").GameRow;
      res.status(200).json({ game: toGameStateDto(out) });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw e;
    } finally {
      client.release();
    }
  }),
);

gamesRouter.post(
  "/api/games/:id/end-turn",
  requireAuth,
  wrapAsync(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const gameId = req.params.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT id, user_id, difficulty, status, board, units, turn_number, ai_last_error,
                used_fallback, moves_applied, last_ai_actions, created_at, updated_at
         FROM games WHERE id = $1 FOR UPDATE`,
        [gameId],
      );
      const row = result.rows[0] as import("./dto").GameRow | undefined;
      if (!row || row.user_id !== user.id) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (row.status !== "player_turn") {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Game is not waiting for your turn" });
        return;
      }

      // victory check on 14 as per spec: if all enemy units dead, no AI turn happens -> won directly
      const victory = checkVictory((row.units ?? []) as Unit[]);
      if (victory === "player") {
        const updatedWon = await client.query(
          `UPDATE games
           SET status = 'won',
               moves_applied = false,
               updated_at = now()
           WHERE id = $1
           RETURNING id, user_id, difficulty, status, board, units, turn_number, ai_last_error,
                     used_fallback, moves_applied, last_ai_actions, created_at, updated_at`,
          [gameId],
        );
        await client.query("COMMIT");
        res
          .status(200)
          .json({ game: toGameStateDto(updatedWon.rows[0] as import("./dto").GameRow) });
        return;
      }

      const resetUnits = ((row.units ?? []) as Unit[]).map((u) => ({ ...u, acted: false }));
      const updated = await client.query(
        `UPDATE games
         SET status = 'ai_turn',
             units = $2::jsonb,
             moves_applied = false,
             updated_at = now()
         WHERE id = $1
         RETURNING id, user_id, difficulty, status, board, units, turn_number, ai_last_error,
                   used_fallback, moves_applied, last_ai_actions, created_at, updated_at`,
        [gameId, JSON.stringify(resetUnits)],
      );
      await client.query("COMMIT");
      const out = updated.rows[0] as import("./dto").GameRow;
      res.status(200).json({ game: toGameStateDto(out) });
      kickOffAiTurn(gameId);
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw e;
    } finally {
      client.release();
    }
  }),
);

gamesRouter.post(
  "/api/games/:id/forfeit",
  requireAuth,
  wrapAsync(async (req, res) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const gameId = req.params.id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `SELECT id, user_id, status, difficulty, board, units, turn_number, ai_last_error,
                used_fallback, moves_applied, last_ai_actions, created_at, updated_at
         FROM games WHERE id = $1 FOR UPDATE`,
        [gameId],
      );
      const row = result.rows[0] as import("./dto").GameRow | undefined;
      if (!row || row.user_id !== user.id) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (row.status === "won" || row.status === "lost") {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Game already finished" });
        return;
      }
      if (
        row.status !== "generating_board" &&
        row.status !== "player_turn" &&
        row.status !== "ai_turn"
      ) {
        await client.query("ROLLBACK");
        res.status(409).json({ error: "Game already finished" });
        return;
      }
      const updated = await client.query(
        `UPDATE games
         SET status = 'lost',
             updated_at = now()
         WHERE id = $1
         RETURNING id, user_id, difficulty, status, board, units, turn_number, ai_last_error,
                   used_fallback, moves_applied, last_ai_actions, created_at, updated_at`,
        [gameId],
      );
      await client.query("COMMIT");
      res.status(200).json({ game: toGameStateDto(updated.rows[0] as import("./dto").GameRow) });
    } catch (e) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
      throw e;
    } finally {
      client.release();
    }
  }),
);
