import { getConfig } from "../../config/config.js";
import { makeBriefJsonSchema } from "../board/briefSchema.js";
import { MockLlm } from "./mockLlm.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmClient {
  chat(args: {
    messages: ChatMessage[]; // caller builds: system + state + (on retries) prior failures
    temperature: number;
    schema: object; // JSON Schema; Ollama `format` field guarantees valid JSON output
  }): Promise<unknown>; // parsed JSON object (still un-validated — callers zod it)

  brief(opts: { user: string }): Promise<unknown>; // single-shot board-design call (03)
  turn(opts: {
    messages: ChatMessage[];
    temperature: number;
  }): Promise<unknown>; // AI-turn call (04)
}

/** Non-2xx or unparsable LLM exchange — a failed attempt, never a crash (04). */
export class LlmError extends Error {}

/**
 * The real client: one small module over Ollama's native chat API (04). No
 * streaming, no history, no sessions. OLLAMA_URL/OLLAMA_MODEL are read at call
 * time — loadEnv validated them at boot, and tests never touch this class.
 */
class OllamaLlm implements LlmClient {
  async chat(args: {
    messages: ChatMessage[];
    temperature: number;
    schema: object;
  }): Promise<unknown> {
    const url = process.env.OLLAMA_URL;
    const model = process.env.OLLAMA_MODEL;
    if (!url || !model) {
      throw new LlmError("OLLAMA_URL/OLLAMA_MODEL are not set");
    }
    let response: Response;
    try {
      response = await fetch(`${url}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: args.messages,
          stream: false,
          format: args.schema,
          options: { temperature: args.temperature },
        }),
      });
    } catch (err) {
      throw new LlmError("Ollama is unreachable", { cause: err });
    }
    if (!response.ok) {
      throw new LlmError(`Ollama answered ${response.status}`);
    }
    let body: { message?: { content?: unknown } };
    try {
      body = (await response.json()) as { message?: { content?: unknown } };
    } catch (err) {
      throw new LlmError("Ollama response was not JSON", { cause: err });
    }
    const content = body.message?.content;
    if (typeof content !== "string") {
      throw new LlmError("Ollama response has no message content");
    }
    try {
      return JSON.parse(content);
    } catch (err) {
      throw new LlmError("Ollama content was not parsable JSON", {
        cause: err,
      });
    }
  }

  /** Call #1 — board design brief (03): single-shot, briefTemperature from config. */
  async brief(opts: { user: string }): Promise<unknown> {
    return this.chat({
      messages: [{ role: "user", content: opts.user }],
      temperature: getConfig().ai.briefTemperature,
      schema: makeBriefJsonSchema(getConfig().boardSize),
    });
  }

  async turn(): Promise<unknown> {
    throw new LlmError("LlmClient.turn is a phase 5 deliverable");
  }
}

/**
 * Two implementations, chosen explicitly; no plugin system (04). LLM_MOCK=1
 * selects the fixture client — test runners inject it automatically, local
 * .env may set it for day-to-day dev, production never does.
 */
export function createLlmClient(): LlmClient {
  return process.env.LLM_MOCK === "1" ? new MockLlm() : new OllamaLlm();
}
