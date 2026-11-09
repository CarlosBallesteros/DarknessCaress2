import { readFileSync } from "node:fs";

export interface ClassConfig {
  count: number;
  hp: number;
  atk: number;
  def: number;
  mov: number;
  range: number[];
  role: "attacker" | "supporter";
  label: string;
  healAmount?: number;
}

export interface ThemeConfig {
  id: string;
  label: string;
}

export interface AppConfig {
  boardSize: number;
  maxActiveGames: number;
  classes: Record<string, ClassConfig>;
  personalities: Record<string, { label: string; temperature: number }>;
  themes: ThemeConfig[];
  lore: Record<string, string>;
  ai: {
    moveRetries: number;
    staleAfterSeconds: number;
    briefTemperature: number;
    boardRetries: { materializations: number; briefs: number };
  };
}

let config: AppConfig | undefined;

/**
 * THE single config file, loaded once (01-architecture.md). tsc does not copy
 * .json assets into dist/, so the file is read from the package-root `src/` —
 * two levels up resolves to the package root both here and from dist/config/.
 * The production image ships `src/` (server/Dockerfile copies the workspace).
 */
export function getConfig(): AppConfig {
  config ??= JSON.parse(
    readFileSync(
      new URL("../../src/config/config.json", import.meta.url),
      "utf8",
    ),
  ) as AppConfig;
  return config;
}
