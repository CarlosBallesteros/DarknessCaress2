import rawConfig from "../config/config.json";
import type { GameEngineConfig } from "./types";

type RawClass = {
  count: number;
  hp: number;
  atk: number;
  def: number;
  mov: number;
  range: number[];
  healAmount?: number;
  role?: "attacker" | "supporter";
};

export type RawGameConfig = {
  boardSize: number;
  classes: Record<string, RawClass>;
};

export function projectGameEngineConfig(raw: RawGameConfig): GameEngineConfig {
  return {
    boardSize: raw.boardSize,
    classes: {
      sword: { ...raw.classes.sword },
      axe: { ...raw.classes.axe },
      spear: { ...raw.classes.spear },
      archer: { ...raw.classes.archer },
      mage: { ...raw.classes.mage },
      healer: { ...raw.classes.healer },
    },
  };
}

export const gameEngineConfig = projectGameEngineConfig(rawConfig as RawGameConfig);
