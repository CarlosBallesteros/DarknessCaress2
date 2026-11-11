// Projection of the canonical config file (docs/01) into the engine's
// GameEngineConfig (docs/02). The engine never reads the file itself — feature
// code and tests pass the projection around. The static import below is
// load-time only: config.json is compiled in, there is no runtime I/O here.
import { config, type GameConfig } from "../config/config";
import type { ClassKey, GameEngineConfig } from "./types";

const CLASS_KEYS: ClassKey[] = [
  "sword",
  "axe",
  "spear",
  "archer",
  "mage",
  "healer",
];

// Drops every field engine math must not see (labels, personalities, AI knobs)
// and keeps only the stat fields of docs/02's GameEngineConfig shape.
export function toEngineConfig(
  raw: Pick<GameConfig, "boardSize" | "classes">,
): GameEngineConfig {
  if (!Number.isInteger(raw.boardSize) || raw.boardSize < 1) {
    throw new Error("config boardSize must be a positive integer");
  }
  const classes = {} as GameEngineConfig["classes"];
  for (const key of CLASS_KEYS) {
    const c = raw.classes[key];
    if (!c) throw new Error(`config is missing the "${key}" class`);
    classes[key] = {
      count: c.count,
      hp: c.hp,
      atk: c.atk,
      def: c.def,
      mov: c.mov,
      range: [...c.range],
      ...(c.healAmount !== undefined ? { healAmount: c.healAmount } : {}),
      role: c.role,
    };
  }
  return { boardSize: raw.boardSize, classes };
}

export const engineConfig: GameEngineConfig = toEngineConfig(config);
