import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type GameConfig = {
  boardSize: number;
  maxActiveGames: number;
  classes: Record<string, unknown>;
  personalities: Record<string, { label: string; temperature: number }>;
  themes: Array<{ id: string; label: string }>;
  lore: Record<string, string>;
  ai: {
    moveRetries: number;
    staleAfterSeconds: number;
    sweepIntervalSeconds: number;
    briefTemperature: number;
    boardRetries: { materializations: number; briefs: number };
  };
};

let cachedConfig: GameConfig | null = null;

export async function loadConfig(): Promise<GameConfig> {
  if (cachedConfig) return cachedConfig;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const configPath = path.join(__dirname, "config.json");
  const raw = await readFile(configPath, "utf8");
  cachedConfig = JSON.parse(raw) as GameConfig;
  return cachedConfig;
}

export function getConfig(): GameConfig {
  if (!cachedConfig) {
    throw new Error("Config not loaded");
  }
  return cachedConfig;
}
