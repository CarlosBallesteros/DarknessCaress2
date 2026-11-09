import { getConfig, toEngineConfig } from "../../config/config.js";
import { getPool } from "../../db/pool.js";
import {
  applyMoves,
  checkVictory,
  type AppliedTurn,
} from "../../game/apply.js";
import type { Board, GameEngineConfig, Move, Unit } from "../../game/types.js";
import {
  applyAiTurnResult,
  getGameById,
  markAiTurnFailed,
} from "../games/games.queries.js";
import { toAiActions } from "./aiActions.js";
import {
  createLlmClient,
  type ChatMessage,
  type LlmClient,
} from "./llmClient.js";
import { PERSONA_BEHAVIOR_TEXTS } from "./personas.js";
import { buildTurnSystemPrompt, buildTurnUserMessage } from "./turnPrompt.js";
import { turnResponseSchema } from "./turnSchema.js";

const SCHEMA_FAIL_MESSAGE =
  "Your reply was not valid JSON matching the schema.";

/**
 * 01's ACTIVE-JOB set — the race-proof idempotency guard. An entry is added
 * SYNCHRONOUSLY (check-and-set in the same tick, before any await) and removed
 * only when the job completes (success or failure); a sweep skips any game
 * with an active entry. No time window: however long the LLM takes, a running
 * job is never double-launched. A server restart empties the map — which is
 * precisely when self-heal is wanted.
 */
const activeJobs = new Map<string, number>();

export function isAiTurnRunning(gameId: string): boolean {
  return activeJobs.has(gameId);
}

/**
 * Fire-and-forget launcher (01): the route kicks off the AI turn without
 * awaiting it, with an appended safe catch that logs. Also the single entry
 * point for the stale-recovery sweep — the guard makes re-triggering
 * idempotent.
 */
export function triggerAiTurn(gameId: string): void {
  if (activeJobs.has(gameId)) {
    return;
  }
  activeJobs.set(gameId, Date.now());
  runAiTurn(gameId)
    .catch((err: unknown) => {
      console.error(`ai turn job failed for game ${gameId}:`, err);
    })
    .finally(() => {
      activeJobs.delete(gameId);
    });
}

/**
 * Stale recovery (01, endpoints 9/11 side effect): re-triggers jobs for the
 * user's games sitting in ai_turn with an updated_at older than
 * config.ai.staleAfterSeconds. Optionally scoped to one game.
 */
export async function retriggerStaleAiTurns(
  userId: string,
  gameId?: string,
): Promise<void> {
  const params: unknown[] = [userId, getConfig().ai.staleAfterSeconds];
  let sql = `SELECT id FROM games
             WHERE user_id = $1 AND status = 'ai_turn'
               AND updated_at < now() - make_interval(secs => $2)`;
  if (gameId !== undefined) {
    sql += " AND id = $3";
    params.push(gameId);
  }
  const result = await getPool().query<{ id: string }>(sql, params);
  for (const row of result.rows) {
    triggerAiTurn(row.id);
  }
}

/** 04's retry feedback: the engine's exact rejection, unit ids for context, resubmit order. */
export function buildCorrectionMessage(
  moves: Move[],
  engineError: string,
): string {
  const unitIds = [...new Set(moves.map((move) => move.unitId))].join(", ");
  return `${unitIds}: ${engineError}. Resubmit the FULL corrected move list.`;
}

export type TurnLoopResult =
  | {
      ok: true;
      applied: AppliedTurn;
      moves: Move[];
      attempt: number;
      responseChars: number;
    }
  | { ok: false; error: string };

/**
 * The bounded validation loop of 04, exact: zod (discriminated union) →
 * applyMoves → on failure the model is told the engine's exact rejection and
 * resends the FULL corrected list. attempt = 1..config.ai.moveRetries. The
 * conversation keeps growing in `messages`; a partially valid list is never
 * applied (applyMoves is whole-bundle atomic). NO fallback AI ever plays.
 */
export async function runTurnValidationLoop(opts: {
  llm: LlmClient;
  messages: ChatMessage[];
  temperature: number;
  state: { board: Board; units: Unit[] };
  engineCfg: GameEngineConfig;
  retries: number;
}): Promise<TurnLoopResult> {
  const { llm, messages, temperature, state, engineCfg, retries } = opts;
  let lastError = "";
  for (let attempt = 1; attempt <= retries; attempt++) {
    let raw: unknown;
    try {
      raw = await llm.turn({ messages, temperature });
    } catch (err) {
      // A typed LlmError is a failed attempt, never a crashed process (04).
      lastError = err instanceof Error ? err.message : String(err);
      messages.push({ role: "user", content: SCHEMA_FAIL_MESSAGE });
      continue;
    }
    const parsed = turnResponseSchema.safeParse(raw);
    if (!parsed.success) {
      lastError = SCHEMA_FAIL_MESSAGE;
      messages.push(
        { role: "assistant", content: JSON.stringify(raw) },
        { role: "user", content: SCHEMA_FAIL_MESSAGE },
      );
      continue;
    }
    const applied = applyMoves(state, parsed.data.moves, "enemy", engineCfg);
    if (!applied.ok) {
      lastError = applied.error;
      messages.push(
        { role: "assistant", content: JSON.stringify(parsed.data) },
        {
          role: "user",
          content: buildCorrectionMessage(parsed.data.moves, applied.error),
        },
      );
      continue;
    }
    return {
      ok: true,
      applied: applied.result,
      moves: parsed.data.moves,
      attempt,
      responseChars: JSON.stringify(raw).length,
    };
  }
  return { ok: false, error: lastError };
}

/**
 * The AI turn job (01/04): load state → prompt the LLM → validate + apply with
 * the pure engine → persist conditionally. On success the row flips to
 * player_turn | lost (never won — 06's status matrix has no ai_turn → won),
 * turn_number advances, last_ai_actions is stored, ai_last_error cleared. On
 * exhaustion ai_last_error is set, status stays ai_turn, updated_at = now()
 * (fresh sweep timer) and turn_number is unchanged. Recovery is the
 * stale-recovery sweep's business — never a fallback heuristic.
 */
export async function runAiTurn(gameId: string): Promise<void> {
  const row = await getGameById(gameId);
  if (row === undefined || row.status !== "ai_turn") {
    return;
  }
  const config = getConfig();
  const engineCfg = toEngineConfig(config);
  const persona = config.personalities[row.difficulty];
  const behaviorText =
    persona === undefined ? undefined : PERSONA_BEHAVIOR_TEXTS[row.difficulty];
  if (persona === undefined || behaviorText === undefined) {
    // Difficulty is validated against config at creation; a config that lost
    // the persona (or its behavior text) is a code/config mismatch — loud.
    throw new Error(`no persona behavior text for "${row.difficulty}"`);
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: buildTurnSystemPrompt(behaviorText, config.boardSize),
    },
    {
      role: "user",
      content: buildTurnUserMessage(row.board, row.units, config),
    },
  ];
  const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const startedAt = Date.now();

  const result = await runTurnValidationLoop({
    llm: createLlmClient(),
    messages,
    temperature: persona.temperature,
    state: { board: row.board, units: row.units },
    engineCfg,
    retries: config.ai.moveRetries,
  });

  if (!result.ok) {
    await markAiTurnFailed(gameId, result.error);
    return;
  }
  // "player" = enemy army wiped — but only the player's own moves can win (06);
  // the AI turn can at most lose the GAME for the player ("enemy" = player wiped).
  const victory = checkVictory(result.applied.state.units);
  const status = victory === "enemy" ? "lost" : "player_turn";
  const persisted = await applyAiTurnResult(gameId, {
    status,
    units: result.applied.state.units,
    lastAiActions: toAiActions(result.moves, result.applied.events),
  });
  if (persisted) {
    // 04's log discipline: these fields only; never full request/response pairs.
    console.log(
      JSON.stringify({
        gameId,
        durationMs: Date.now() - startedAt,
        promptChars,
        responseChars: result.responseChars,
        attempt: result.attempt,
      }),
    );
  }
  // A discarded result (the game left ai_turn meanwhile) simply stands down.
}
