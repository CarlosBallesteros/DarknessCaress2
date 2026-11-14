export function ensureTestEnv(): void {
  process.env.DATABASE_URL ??= "postgres://dc:dc@127.0.0.1:5432/darknesscaress";
  process.env.JWT_SECRET ??= "test-secret-0123456789abcdef0123456789abcdef";
  process.env.OLLAMA_URL ??= "http://localhost:11434";
  process.env.OLLAMA_MODEL ??= "qwen2.5:7b-instruct-q4_K_M";
  process.env.PORT ??= "3000";
  process.env.NODE_ENV ??= "test";
}
