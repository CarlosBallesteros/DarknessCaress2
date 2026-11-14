import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  OLLAMA_URL: z.string().url(),
  OLLAMA_MODEL: z.string().min(1),
  LLM_MOCK: z.string().optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.string().default("development"),
});

export const env = envSchema.parse(process.env);
export type Env = typeof env;
