import type { BoardBrief } from "../board/briefSchema";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmClient {
  chat(args: { messages: ChatMessage[]; temperature: number; schema: object }): Promise<unknown>;

  brief(opts: { user: string }): Promise<unknown>;
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

export type { BoardBrief };
