import { Router } from "express";
import type { Pool } from "pg";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { projectEngineConfig } from "../../game/config.js";
import { applyMoves, checkVictory } from "../../game/apply.js";
import { previewMove } from "../../game/reach.js";
import type { Board, GameEngineConfig, Move, Tile, Unit } from "../../game/types.js";
import type { LlmClient } from "../ai/llmClient.js";
import type { AuthenticatedRequest } from "../auth/requireAuth.js";
import { wrapAsync } from "../wrapAsync.js";
import { toGameState, toGameSummary } from "./dto.js";
import {
  countActiveGames,
  endPlayerTurn,
  findGameByIdForUser,
  findGameForUpdate,
  forfeitGame,
  insertGeneratingGame,
  listGamesForUser,
  markMovesAppliedEmpty,
  updateGameAfterPlayerMoves,
  withTransaction,
} from "./repo.js";
import { runAiTurnJob, runBoardGenerationJob, triggerStaleJobsForUser } from "./jobs.js";

function firstZodIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Validation error";
}

function makePlaceholderBoard(size: number): Board {
  const tiles: Tile[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => "plain" as Tile),
  );
  return { tiles };
}

function asEngineConfig(config: AppConfig): GameEngineConfig {
  return projectEngineConfig(config as unknown as Parameters<typeof projectEngineConfig>[0]);
}

function findUnit(units: Unit[], id: string): Unit | undefined {
  return units.find((u) => u.id === id);
}

// Zod schema for moves request: shape validation; engine-level messages handled separately where needed.
const pathPointSchema = z.tuple([z.number().int(), z.number().int()]);
const moveSchema = z.object({
  unitId: z.string(),
  path: z.array(pathPointSchema).min(1),
  action: z.object({
    type: z.string(),
    targetId: z.string().optional(),
  }),
});
const movesBodySchema = z
  .object({
    moves: z.array(moveSchema),
  })
  .strict();

export function createGamesRouter(
  pool: Pool,
  config: AppConfig,
  requireAuth: ReturnType<typeof import("../auth/requireAuth.js").createRequireAuth>,
  llm: LlmClient,
): Router {
  const router = Router();
  const engineConfig = asEngineConfig(config);

  const createSchema = z
    .object({
      difficulty: z.string(),
    })
    .strict();

  // 10. POST /api/games
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

      runBoardGenerationJob(pool, config, llm, row.id);

      res.status(202).json({ game: toGameState(row) });
    }),
  );

  // 9. GET /api/games (list) — stale recovery side effect for this user (both job types)
  router.get(
    "/games",
    requireAuth,
    wrapAsync(async (req, res) => {
      const authReq = req as AuthenticatedRequest;
      await triggerStaleJobsForUser(pool, config, llm, authReq.user.id);
      const rows = await listGamesForUser(pool, authReq.user.id);
      res.status(200).json({ games: rows.map(toGameSummary) });
    }),
  );

  // 11. GET /api/games/:id — stale recovery for this game (ai_turn and stalled generating_board)
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
      // Stale-recovery side effect for this game (both ai_turn and generating_board)
      if (row.status === "generating_board" || row.status === "ai_turn") {
        const updatedMs =
          row.updated_at instanceof Date
            ? row.updated_at.getTime()
            : new Date(row.updated_at).getTime();
        const staleMs = Math.max(0, config.ai.staleAfterSeconds) * 1000;
        if (Date.now() - updatedMs > staleMs) {
          if (row.status === "generating_board") {
            runBoardGenerationJob(pool, config, llm, row.id);
          } else {
            runAiTurnJob(pool, config, row.id);
          }
        }
      }
      // Return state at query time (job runs async)
      res.status(200).json({ game: toGameState(row) });
    }),
  );

  // 12. GET /api/games/:id/preview/:unitId
  router.get(
    "/games/:id/preview/:unitId",
    requireAuth,
    wrapAsync(async (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const { id, unitId } = req.params;
      if (!id || !unitId) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const row = await findGameByIdForUser(pool, id, authReq.user.id);
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (row.status !== "player_turn") {
        res.status(409).json({ error: "Game is not waiting for your turn" });
        return;
      }
      const units = (row.units as Unit[]).map((u) => ({ ...u }));
      const unit = findUnit(units, unitId);
      if (!unit) {
        res.status(404).json({ error: "Unit not playable" });
        return;
      }
      // Own units: already-acted own units excluded
      if (unit.side === "player" && unit.acted) {
        res.status(404).json({ error: "Unit not playable" });
        return;
      }
      // Enemy units allowed for read-only inspection
      const board = row.board as Board;
      const preview = previewMove(board, units, unit, engineConfig);
      res.status(200).json({
        moveTiles: preview.moveTiles,
        attackTiles: preview.attackTiles,
        healTiles: preview.healTiles,
        side: unit.side,
      });
    }),
  );

  // 13. POST /api/games/:id/moves
  router.post(
    "/games/:id/moves",
    requireAuth,
    wrapAsync(async (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const { id } = req.params;
      if (!id) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const parsed = movesBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: firstZodIssue(parsed.error) });
        return;
      }

      const movesInput = parsed.data.moves as Move[];

      const result = await withTransaction(pool, async (client) => {
        const row = await findGameForUpdate(client, id, authReq.user.id);
        if (!row) {
          return { kind: "not_found" as const };
        }
        if (row.status !== "player_turn") {
          return { kind: "not_player_turn" as const };
        }
        if (row.moves_applied) {
          return { kind: "already_submitted" as const };
        }

        // empty moves: valid submission, applies nothing, consumes round budget
        if (movesInput.length === 0) {
          const updated = await markMovesAppliedEmpty(client, id);
          return { kind: "ok" as const, row: updated };
        }

        // Holistic validation entry-by-entry against evolving state; apply nothing on failure
        const board = row.board as Board;
        let state: { board: Board; units: Unit[] } = {
          board,
          units: (row.units as Unit[]).map((u) => ({ ...u })),
        };

        for (let i = 0; i < movesInput.length; i++) {
          const move = movesInput[i];
          const applied = applyMoves(state, [move], "player", engineConfig);
          if (!applied.ok) {
            return { kind: "invalid" as const, index: i, message: applied.error };
          }
          state = applied.result.state;
        }

        // All valid: persist atomically
        const victory = checkVictory(state.units);
        const nextStatus: "player_turn" | "won" = victory === "player" ? "won" : "player_turn";
        const updated = await updateGameAfterPlayerMoves(client, id, state.units, nextStatus);
        return { kind: "ok" as const, row: updated };
      });

      if (result.kind === "not_found") {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (result.kind === "not_player_turn") {
        res.status(409).json({ error: "Game is not waiting for your turn" });
        return;
      }
      if (result.kind === "already_submitted") {
        res.status(409).json({ error: "Turn moves already submitted" });
        return;
      }
      if (result.kind === "invalid") {
        res.status(400).json({ error: `move ${result.index + 1}: ${result.message}` });
        return;
      }

      res.status(200).json({ game: toGameState(result.row) });
    }),
  );

  // 14. POST /api/games/:id/end-turn
  router.post(
    "/games/:id/end-turn",
    requireAuth,
    wrapAsync(async (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const { id } = req.params;
      if (!id) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const result = await withTransaction(pool, async (client) => {
        const row = await findGameForUpdate(client, id, authReq.user.id);
        if (!row) {
          return { kind: "not_found" as const };
        }
        if (row.status !== "player_turn") {
          return { kind: "not_player_turn" as const };
        }

        // Victory check runs here too
        const units = row.units as Unit[];
        const victory = checkVictory(units);
        if (victory === "player") {
          const wonRes = await client.query(
            `UPDATE games SET status = 'won', updated_at = now() WHERE id = $1 AND status = 'player_turn' RETURNING *`,
            [id],
          );
          return { kind: "won" as const, row: wonRes.rows[0] };
        }

        const ended = await endPlayerTurn(client, id);
        if (!ended) {
          return { kind: "not_player_turn" as const };
        }
        return { kind: "ai_turn" as const, row: ended };
      });

      if (result.kind === "not_found") {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (result.kind === "not_player_turn") {
        res.status(409).json({ error: "Game is not waiting for your turn" });
        return;
      }

      if (result.kind === "ai_turn") {
        // fire background AI turn job (non-blocking)
        runAiTurnJob(pool, config, id);
      }

      res.status(200).json({ game: toGameState(result.row) });
    }),
  );

  // 15. POST /api/games/:id/forfeit
  router.post(
    "/games/:id/forfeit",
    requireAuth,
    wrapAsync(async (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const { id } = req.params;
      if (!id) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const outcome = await forfeitGame(pool, id, authReq.user.id);
      if (outcome.kind === "not_found") {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (outcome.kind === "finished") {
        res.status(409).json({ error: "Game already finished" });
        return;
      }
      res.status(200).json({ game: toGameState(outcome.row) });
    }),
  );

  return router;
}
