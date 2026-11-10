// Zod-validated environment (docs/01): parsed once at import time; a missing or
// malformed variable makes the process exit loudly instead of booting half-up.
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  OLLAMA_URL: z.string().url(),
  OLLAMA_MODEL: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["production", "development", "test"]).default("production"),
  LLM_MOCK: z.enum(["0", "1"]).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(
    "Invalid environment variables:",
    parsed.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`,
    ),
  );
  process.exit(1);
}

export const env = parsed.data;
