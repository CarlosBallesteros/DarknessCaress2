import { z } from "zod";
import { loadEnv } from "../../env.js";
import { briefFixture } from "./mockLlm.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmClient {
  chat(args: { messages: ChatMessage[]; temperature: number; schema: object }): Promise<unknown>;

  brief(opts: {
    user: string;
    prompt: string;
    temperature: number;
    schema: object;
  }): Promise<unknown>;

  // Phase 5 will implement move-turn decisions; stubbed for phase 4.
  turn(): Promise<unknown>;
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

function isMockMode(): boolean {
  if (process.env.LLM_MOCK === "1") return true;
  // Tests and local dev may run without full env; prefer mock when no Ollama URL configured.
  return !process.env.OLLAMA_URL || !process.env.OLLAMA_MODEL;
}

function createRealClient(): LlmClient {
  const env = loadEnv();
  const baseUrl = env.OLLAMA_URL.replace(/\/$/, "");

  async function chat(args: {
    messages: ChatMessage[];
    temperature: number;
    schema: object;
  }): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: env.OLLAMA_MODEL,
          messages: args.messages,
          stream: false,
          format: args.schema,
          options: { temperature: args.temperature, num_predict: 2048 },
        }),
      });
    } catch (err) {
      throw new LlmError(`LLM request failed: ${String(err)}`);
    }
    if (!res.ok) {
      throw new LlmError(`LLM request failed with status ${res.status}`);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new LlmError("LLM response was not valid JSON");
    }
    const parsed = z
      .object({
        message: z.object({ content: z.string() }),
      })
      .safeParse(body);
    if (!parsed.success) {
      throw new LlmError("LLM response missing message content");
    }
    try {
      return JSON.parse(parsed.data.message.content) as unknown;
    } catch {
      throw new LlmError("LLM message content was not valid JSON");
    }
  }

  return {
    chat,
    async brief(opts): Promise<unknown> {
      const start = Date.now();
      const messages: ChatMessage[] = [{ role: "user", content: opts.prompt }];
      const promptChars = opts.prompt.length;
      try {
        const result = await chat({
          messages,
          temperature: opts.temperature,
          schema: opts.schema,
        });
        const responseChars = JSON.stringify(result).length;
        console.log(
          JSON.stringify({
            call: "brief",
            durationMs: Date.now() - start,
            promptChars,
            responseChars,
          }),
        );
        return result;
      } catch (err) {
        const responseChars = 0;
        console.log(
          JSON.stringify({
            call: "brief",
            durationMs: Date.now() - start,
            promptChars,
            responseChars,
          }),
        );
        throw err;
      }
    },
    async turn(): Promise<unknown> {
      throw new LlmError("turn() is not implemented in phase 4");
    },
  };
}

function createMockClient(): LlmClient {
  return {
    async chat(): Promise<unknown> {
      return briefFixture;
    },
    async brief(): Promise<unknown> {
      // Committed fixture JSON; deterministic for tests and mock flows.
      return structuredClone(briefFixture);
    },
    async turn(): Promise<unknown> {
      throw new LlmError("turn() is not implemented in phase 4");
    },
  };
}

let singleton: LlmClient | null = null;

export function getLlmClient(): LlmClient {
  if (singleton) return singleton;
  singleton = isMockMode() ? createMockClient() : createRealClient();
  return singleton;
}

export function resetLlmClientForTests(): void {
  singleton = null;
}
