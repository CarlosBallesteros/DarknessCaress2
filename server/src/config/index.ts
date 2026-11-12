import fs from "node:fs";
import path from "node:path";

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

export interface PersonalityConfig {
  label: string;
  temperature: number;
}

export interface ThemeConfig {
  id: string;
  label: string;
}

export interface BoardRetryConfig {
  materializations: number;
  briefs: number;
}

export interface AiConfig {
  moveRetries: number;
  staleAfterSeconds: number;
  sweepIntervalSeconds: number;
  briefTemperature: number;
  boardRetries: BoardRetryConfig;
}

export interface Config {
  boardSize: number;
  maxActiveGames: number;
  classes: Record<string, ClassConfig>;
  personalities: Record<string, PersonalityConfig>;
  themes: ThemeConfig[];
  lore: Record<string, string>;
  ai: AiConfig;
}

export const config: Config = JSON.parse(
  fs.readFileSync(path.join(__dirname, "config.json"), "utf8"),
);
