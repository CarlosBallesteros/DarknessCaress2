// The one LLM seam (docs/04). The real client speaks Ollama's native chat
// API; the mock (docs/04 → mockLlm) serves committed fixtures and is selected
// by LLM_MOCK=1 — the test runners inject it automatically, day-to-day local
// dev sets it in .env, production never does. No plugin system: two
// implementations, chosen explicitly.
import { config } from "../../config/config";
import { env } from "../../env";
import { briefJsonSchema } from "../board/brief-schema";
import { TURN_JSON_SCHEMA } from "./turn-schema";
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
  turn(opts: {
    messages: ChatMessage[];
    temperature: number;
  }): Promise<unknown>;
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
        options: { temperature: body.temperature },
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
  const content = (payload as { message?: { content?: unknown } })?.message
    ?.content;
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
  chat: ({ messages, temperature, schema }) =>
    postChat({ messages, temperature, schema }),

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

  turn: ({ messages, temperature }) =>
    postChat({ messages, temperature, schema: TURN_JSON_SCHEMA }),
};

export function getLlmClient(): LlmClient {
  return env.LLM_MOCK === "1" ? mockLlm : ollamaLlm;
}
