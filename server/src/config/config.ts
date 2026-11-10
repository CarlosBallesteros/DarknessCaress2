// Loader for THE single config file (docs/01): every game tunable lives here,
// in code nowhere else. Typed projection of the canonical JSON shape.
import raw from "./config.json";

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

export interface AiConfig {
  moveRetries: number;
  staleAfterSeconds: number;
  briefTemperature: number;
  boardRetries: { materializations: number; briefs: number };
}

export interface GameConfig {
  boardSize: number;
  maxActiveGames: number;
  classes: Record<string, ClassConfig>;
  personalities: Record<string, PersonalityConfig>;
  themes: ThemeConfig[];
  lore: Record<string, string>;
  ai: AiConfig;
}

export const config = raw as GameConfig;
