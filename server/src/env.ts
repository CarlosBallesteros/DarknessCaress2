import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(1),
  OLLAMA_URL: z.string().url(),
  OLLAMA_MODEL: z.string().min(1),
  PORT: z.coerce.number().int().positive(),
  NODE_ENV: z.enum(["production", "development", "test"]),
  LLM_MOCK: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validates the environment once at boot; exits loudly if a variable is
 * missing or malformed (01-architecture.md).
 */
export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error(
      "Invalid environment variables:",
      result.error.flatten().fieldErrors,
    );
    process.exit(1);
  }
  return result.data;
}
