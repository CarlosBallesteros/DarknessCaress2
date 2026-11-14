import briefFixture from "./__fixtures__/brief.valid.json";
import type { LlmClient, ChatMessage } from "./llmClient";

export class MockLlmClient implements LlmClient {
  async chat(_args: {
    messages: ChatMessage[];
    temperature: number;
    schema: object;
  }): Promise<unknown> {
    void _args;
    return briefFixture;
  }

  async brief(_opts: { user: string }): Promise<unknown> {
    void _opts;
    return briefFixture;
  }
}
