import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  OLLAMA_URL: z.string().url(),
  OLLAMA_MODEL: z.string().min(1),
  LLM_MOCK: z.enum(["0", "1"]).optional(),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Exits loudly at boot per docs/01 — a server with unknown env is worse than no server.
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env: Env = parsed.data;
