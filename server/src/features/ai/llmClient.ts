// The one LLM seam (docs/04). The real client speaks Ollama's native chat
// API; the mock (docs/04 → mockLlm) serves committed fixtures and is selected
// by LLM_MOCK=1 — the test runners inject it automatically, day-to-day local
// dev sets it in .env, production never does. No plugin system: two
// implementations, chosen explicitly.
import { config } from "../../config/load";
import { env } from "../../env";
import { briefJsonSchema } from "../board/briefSchema";
import { parseSerializedState } from "./serialize";
import { turnJsonSchema } from "./turnSchema";
import { mockLlm } from "./mockLlm";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmClient {
  chat(args: {
    messages: ChatMessage[];
    temperature: number;
    schema: object; // JSON Schema; Ollama's `format` field guarantees valid JSON
  }): Promise<unknown>; // parsed JSON object, still un-validated — callers zod it

  brief(opts: { user: string }): Promise<unknown>; // single-shot board-design call (docs/03)
  turn(opts: { messages: ChatMessage[]; temperature: number }): Promise<unknown>; // AI-turn call (docs/04, phase 5)
}

// Non-2xx or unparsable ⇒ typed failure: the caller counts it as a failed
// attempt, never as a crashed process.
export class LlmError extends Error {}

async function postChat(body: {
  messages: ChatMessage[];
  temperature: number;
  schema: object;
}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${env.OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        messages: body.messages,
        stream: false,
        format: body.schema,
        // num_predict is MANDATORY (docs/04): an unbounded generation on CPU
        // grammar-constrained decoding can spin for tens of minutes; 1024
        // tokens covers the largest legal response with margin.
        options: { temperature: body.temperature, num_predict: 1024 },
      }),
    });
  } catch (cause) {
    throw new LlmError(`Ollama is unreachable: ${String(cause)}`);
  }
  if (!response.ok) {
    throw new LlmError(`Ollama chat failed with status ${response.status}`);
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new LlmError("Ollama response was not JSON");
  }
  const content = (payload as { message?: { content?: unknown } })?.message?.content;
  if (typeof content !== "string") {
    throw new LlmError("Ollama response is missing message.content");
  }
  try {
    return JSON.parse(content);
  } catch {
    throw new LlmError("Ollama returned unparsable JSON content");
  }
}

export const ollamaLlm: LlmClient = {
  chat: ({ messages, temperature, schema }) => postChat({ messages, temperature, schema }),

  brief: async ({ user }) => {
    const startedAt = Date.now();
    const result = await postChat({
      messages: [{ role: "user", content: user }],
      temperature: config.ai.briefTemperature,
      schema: briefJsonSchema,
    });
    // Success logging per docs/04: counts only, never request/response bodies.
    console.log(
      JSON.stringify({
        call: "brief",
        durationMs: Date.now() - startedAt,
        promptChars: user.length,
        responseChars: JSON.stringify(result).length,
      }),
    );
    return result;
  },

  // The AI-turn call (docs/04). The `format` schema's array bounds are part
  // of the decoding grammar: maxItems for `moves` = the acting side's unit
  // count, derived from the serialized game state carried by the messages
  // (the state at call time — never a frozen literal); path maxItems =
  // boardSize² (from config). The zod authority validates afterwards with
  // the same bound (aiTurn.ts) — the two stay in lockstep.
  turn: async ({ messages, temperature }) => {
    const userMessage = messages.find((message) => message.role === "user");
    const state = userMessage === undefined ? undefined : parseSerializedState(userMessage.content);
    if (state === undefined) {
      throw new LlmError("cannot derive turn schema bounds: no serialized state in messages");
    }
    const actingUnitCount = state.units.filter((unit) => unit.side === "enemy").length;
    return postChat({
      messages,
      temperature,
      schema: turnJsonSchema(actingUnitCount, config.boardSize),
    });
  },
};

export function getLlmClient(): LlmClient {
  return env.LLM_MOCK === "1" ? mockLlm : ollamaLlm;
}
