export function ensureTestEnv(): void {
  process.env.DATABASE_URL ??= "postgres://dc:dc@localhost:5432/darknesscaress";
  process.env.JWT_SECRET ??= "test-secret";
  process.env.OLLAMA_URL ??= "http://localhost:11434";
  process.env.OLLAMA_MODEL ??= "qwen2.5:7b-instruct-q4_K_M";
  process.env.PORT ??= "3000";
  process.env.NODE_ENV ??= "test";
}
