import type { ClassKey, GameEngineConfig } from "../game/types";

type RawClassConfig = {
  count: number;
  hp: number;
  atk: number;
  def: number;
  mov: number;
  range: number[];
  healAmount?: number;
  role?: "attacker" | "supporter";
};

type RawGameConfig = {
  boardSize: number;
  classes: Record<string, RawClassConfig>;
};

export function projectGameEngineConfig(raw: RawGameConfig): GameEngineConfig {
  const classKeys: ClassKey[] = ["sword", "axe", "spear", "archer", "mage", "healer"];
  const classes = {} as GameEngineConfig["classes"];
  for (const key of classKeys) {
    const value = raw.classes[key];
    if (!value) {
      throw new Error(`missing class config: ${key}`);
    }
    classes[key] = {
      count: value.count,
      hp: value.hp,
      atk: value.atk,
      def: value.def,
      mov: value.mov,
      range: [...value.range],
      ...(value.healAmount !== undefined ? { healAmount: value.healAmount } : {}),
      ...(value.role !== undefined ? { role: value.role } : {}),
    };
  }
  return {
    boardSize: raw.boardSize,
    classes,
  };
}

export function loadGameEngineConfigFromFile(
  configPath = require.resolve("./config.json"),
): GameEngineConfig {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const raw = require(configPath) as RawGameConfig;
  return projectGameEngineConfig(raw);
}
