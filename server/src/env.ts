import { z } from "zod";

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(1),
  OLLAMA_URL: z.string().url(),
  OLLAMA_MODEL: z.string().min(1),
  PORT: z.string().default("3000"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  return envSchema.parse(process.env);
}
