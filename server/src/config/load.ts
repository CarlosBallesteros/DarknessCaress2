import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// Canonical shape per docs/01 — the single source of truth for every tunable.
const classSchema = z.object({
  count: z.number().int().nonnegative(),
  hp: z.number().int().positive(),
  atk: z.number().int().nonnegative(),
  def: z.number().int().nonnegative(),
  mov: z.number().int().nonnegative(),
  range: z.array(z.number().int().positive()),
  healAmount: z.number().int().positive().optional(),
  role: z.enum(["attacker", "supporter"]),
  label: z.string().min(1),
});

const configSchema = z.object({
  boardSize: z.number().int().positive(),
  maxActiveGames: z.number().int().positive(),
  classes: z.record(z.string(), classSchema),
  personalities: z.record(
    z.string(),
    z.object({ label: z.string().min(1), temperature: z.number() }),
  ),
  themes: z.array(z.object({ id: z.string().min(1), label: z.string().min(1) })),
  lore: z.record(z.string(), z.string().min(1)),
  ai: z.object({
    moveRetries: z.number().int().nonnegative(),
    staleAfterSeconds: z.number().int().positive(),
    briefTemperature: z.number(),
    boardRetries: z.object({
      materializations: z.number().int().positive(),
      briefs: z.number().int().positive(),
    }),
  }),
});

export type GameConfig = z.infer<typeof configSchema>;

function loadConfig(): GameConfig {
  const raw: unknown = JSON.parse(readFileSync(path.join(__dirname, "config.json"), "utf8"));
  return configSchema.parse(raw);
}

export const config: GameConfig = loadConfig();
