import type { ClassKey, GameEngineConfig } from "../game/types";
import { config, type GameConfig } from "./load";

const CLASS_KEYS: ClassKey[] = ["sword", "axe", "spear", "archer", "mage", "healer"];

// Projects the canonical config (docs/01 shape) onto the engine's
// GameEngineConfig (docs/02): only what the rules engine consumes. The engine
// never reads the file, and its math never branches on `count`/`role` — they
// ride along as metadata for army assembly and the AI prompt layer.
export function projectEngineConfig(config: GameConfig): GameEngineConfig {
  const classes = {} as GameEngineConfig["classes"];
  for (const key of CLASS_KEYS) {
    const cls = config.classes[key];
    if (!cls) throw new Error(`config.json is missing the "${key}" class`);
    classes[key] = {
      count: cls.count,
      hp: cls.hp,
      atk: cls.atk,
      def: cls.def,
      mov: cls.mov,
      range: [...cls.range],
      ...(cls.healAmount !== undefined ? { healAmount: cls.healAmount } : {}),
      role: cls.role,
    };
  }
  return { boardSize: config.boardSize, classes };
}

// Loaded once with the server config (docs/01: "the server loads it once").
export const engineConfig: GameEngineConfig = projectEngineConfig(config);
