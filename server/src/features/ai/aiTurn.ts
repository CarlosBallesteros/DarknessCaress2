// The AI-turn job (docs/04): server-side menu-choice policy, no LLM. The golden
// rule still holds — the engine executes. The policy only selects from
// engine-generated legal options; `applyMoves` validates and applies the
// expanded bundle against the authoritative state. Moves are computed in one
// shot (instant, deterministic per persona except erratic randomness).
import { engineConfig } from "../../config/engine";
import { applyMoves, checkVictory } from "../../game/apply";
import { completeAiTurn, getGameById, markAiTurnFailed } from "../games/repo";
import { toAiActions } from "./aiActions";
import { computePolicyOrders, expandOrders } from "./policy";

export async function runAiTurn(gameId: string): Promise<void> {
  const row = await getGameById(gameId);
  if (row === undefined || row.status !== "ai_turn") {
    return;
  }

  const startedAt = Date.now();
  try {
    const orders = computePolicyOrders(row.board, row.units, row.difficulty);
    const expanded = expandOrders(row.board, row.units, orders, engineConfig);
    const applied = applyMoves(
      { board: row.board, units: row.units },
      expanded,
      "enemy",
      engineConfig,
    );

    if (!applied.ok) {
      // Unexpected: policy should only emit legal bundles. Surface via the
      // failure channel (stale sweep may re-trigger; policy is pure so re-run
      // is safe) rather than crashing or guessing.
      await markAiTurnFailed(gameId, applied.error);
      return;
    }

    // Persist conditionally (docs/04, 06): if the game left ai_turn
    // meanwhile (forfeit during execution), discard. Never won: no ai_turn → won.
    const status = checkVictory(applied.result.state.units) === "enemy" ? "lost" : "player_turn";
    await completeAiTurn(gameId, {
      status,
      units: applied.result.state.units,
      turnNumber: row.turn_number + 1,
      lastAiActions: toAiActions(expanded, applied.result.events),
    });
    console.log(
      JSON.stringify({
        call: "turn",
        gameId,
        durationMs: Date.now() - startedAt,
        policy: row.difficulty,
        moves: expanded.length,
      }),
    );
  } catch (err) {
    await markAiTurnFailed(gameId, err instanceof Error ? err.message : String(err));
  }
}
