import { env } from "../../env";
import { config } from "../../config";
import { LlmError, type ChatMessage, type LlmClient } from "./llmClient";
import { buildBriefPrompt } from "../board/briefPrompt";
import { boardBriefJsonSchema } from "../board/briefJsonSchema";

export class RealLlmClient implements LlmClient {
  async chat(args: {
    messages: ChatMessage[];
    temperature: number;
    schema: object;
  }): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${env.OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: env.OLLAMA_MODEL,
          messages: args.messages,
          stream: false,
          format: args.schema,
          options: { temperature: args.temperature, num_predict: 2048 },
        }),
      });
    } catch {
      throw new LlmError("LLM request failed");
    }

    if (!response.ok) {
      throw new LlmError(`LLM request failed with status ${response.status}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new LlmError("LLM response was not valid JSON");
    }

    const content = (body as { message?: { content?: unknown } })?.message?.content;
    if (typeof content !== "string") {
      throw new LlmError("LLM response missing message content");
    }

    try {
      return JSON.parse(content);
    } catch {
      throw new LlmError("LLM message content was not valid JSON");
    }
  }

  async brief(_opts: { user: string }): Promise<unknown> {
    void _opts;
    const prompt = buildBriefPrompt({ boardSize: config.boardSize });
    const started = Date.now();
    const result = await this.chat({
      messages: [{ role: "user", content: prompt }],
      temperature: config.ai.briefTemperature,
      schema: boardBriefJsonSchema,
    });
    const durationMs = Date.now() - started;
    console.log(
      JSON.stringify({
        call: "brief",
        durationMs,
        promptChars: prompt.length,
        responseChars: JSON.stringify(result).length,
      }),
    );
    return result;
  }
}
