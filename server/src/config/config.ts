import { readFileSync } from "node:fs";
import type { ClassKey, GameEngineConfig } from "../game/types.js";

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

const ENGINE_CLASSES: ClassKey[] = [
  "sword",
  "axe",
  "spear",
  "archer",
  "mage",
  "healer",
];

/**
 * Projects the app config onto the engine's GameEngineConfig shape (02): the
 * `label` belongs to the meta/UI layer only; `count` and `role` ride along as
 * metadata the engine MATH must never branch on.
 */
export function toEngineConfig(app: AppConfig): GameEngineConfig {
  const classes = Object.fromEntries(
    ENGINE_CLASSES.map((key) => {
      const entry = app.classes[key];
      if (!entry) {
        throw new Error(`config is missing class "${key}"`);
      }
      return [
        key,
        {
          count: entry.count,
          hp: entry.hp,
          atk: entry.atk,
          def: entry.def,
          mov: entry.mov,
          range: [...entry.range],
          healAmount: entry.healAmount,
          role: entry.role,
        },
      ];
    }),
  ) as GameEngineConfig["classes"];
  return { boardSize: app.boardSize, classes };
}
