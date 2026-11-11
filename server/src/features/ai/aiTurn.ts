// The AI-turn validation loop (docs/04) — the meat. The golden design rule:
// the LLM decides, the engine executes. The model computes ZERO damage,
// ZERO counters, ZERO deaths — it only returns movement/action intents,
// which src/game/applyMoves validates and executes against the row's
// authoritative state. Any illegal intent bounces back to the model with a
// precise complaint, bounded by config.ai.moveRetries; nothing ever quietly
// degrades, and no heuristic ever plays the enemy army.
import { config } from "../../config/load";
import { engineConfig } from "../../config/engine";
import { applyMoves, checkVictory } from "../../game/apply";
import { completeAiTurn, getGameById, markAiTurnFailed } from "../games/repo";
import { toAiActions } from "./aiActions";
import { getLlmClient, type ChatMessage } from "./llmClient";
import { turnSystemPrompt, turnUserMessage } from "./turnPrompt";
import { turnMovesSchema } from "./turnSchema";

const SCHEMA_FAIL_MESSAGE = "Your reply was not valid JSON matching the schema.";

export async function runAiTurn(gameId: string): Promise<void> {
  const row = await getGameById(gameId);
  if (row === undefined || row.status !== "ai_turn") {
    return;
  }
  const personality = config.personalities[row.difficulty];
  if (personality === undefined) {
    // Config drift (a persona removed after the game was created): the job
    // can never succeed — it surfaces through the same failure channel as
    // every other job, never a heuristic fallback.
    await markAiTurnFailed(gameId, `unknown difficulty "${row.difficulty}"`);
    return;
  }

  const enemyUnitCount = row.units.filter((unit) => unit.side === "enemy").length;
  const messages: ChatMessage[] = [
    { role: "system", content: turnSystemPrompt(row.difficulty) },
    { role: "user", content: turnUserMessage(row.board, row.units) },
  ];
  const promptChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  const startedAt = Date.now();
  let lastError = "";

  for (let attempt = 1; attempt <= config.ai.moveRetries; attempt++) {
    let raw: unknown;
    try {
      raw = await getLlmClient().turn({ messages, temperature: personality.temperature });
    } catch {
      // Unparsable or undeliverable reply — counted as a failed attempt,
      // never a crashed process (docs/04).
      lastError = SCHEMA_FAIL_MESSAGE;
      messages.push({ role: "user", content: SCHEMA_FAIL_MESSAGE });
      continue;
    }
    const parsed = turnMovesSchema(enemyUnitCount, config.boardSize).safeParse(raw);
    if (!parsed.success) {
      lastError = SCHEMA_FAIL_MESSAGE;
      messages.push({ role: "assistant", content: JSON.stringify(raw) });
      messages.push({ role: "user", content: SCHEMA_FAIL_MESSAGE });
      continue;
    }
    const applied = applyMoves(
      { board: row.board, units: row.units },
      parsed.data.moves,
      "enemy",
      engineConfig,
    );
    if (!applied.ok) {
      // The engine's exact rejection (docs/02 catalogue), prefixed with the
      // bundle's unit ids for context, plus the full-resubmit instruction.
      lastError = applied.error;
      messages.push({ role: "assistant", content: JSON.stringify(raw) });
      messages.push({
        role: "user",
        content: `${parsed.data.moves.map((move) => move.unitId).join(", ")}: ${applied.error}\nResubmit the FULL corrected move list.`,
      });
      continue;
    }

    // SUCCESS (docs/04): persist conditionally — if the game left ai_turn
    // meanwhile (a forfeit during the thinking), the result is DISCARDED and
    // the forfeit's lost stands. Never won: docs/06's status matrix has no
    // ai_turn → won.
    const status = checkVictory(applied.result.state.units) === "enemy" ? "lost" : "player_turn";
    await completeAiTurn(gameId, {
      status,
      units: applied.result.state.units,
      turnNumber: row.turn_number + 1,
      lastAiActions: toAiActions(parsed.data.moves, applied.result.events),
    });
    console.log(
      JSON.stringify({
        call: "turn",
        gameId,
        durationMs: Date.now() - startedAt,
        promptChars,
        responseChars: JSON.stringify(raw).length,
        attempt,
      }),
    );
    return;
  }

  // Exhausted (docs/04): ai_last_error set, status stays ai_turn,
  // turn_number unchanged, updated_at = now() (fresh sweep timer — a failed
  // game waits a full stale window before sweeping again). The stale sweep
  // re-triggers with a full fresh prompt and retries reset. NO fallback AI.
  await markAiTurnFailed(gameId, lastError);
}
