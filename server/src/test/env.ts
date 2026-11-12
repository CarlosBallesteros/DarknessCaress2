process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://dc:dc@127.0.0.1:5432/darknesscaress";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret-change-me";
process.env.OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
process.env.OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct-q4_K_M";
process.env.PORT = process.env.PORT ?? "3000";
process.env.NODE_ENV = "test";
