import type { ClassKey, GameEngineConfig } from "./types.js";

type RawClass = {
  count?: unknown;
  hp?: unknown;
  atk?: unknown;
  def?: unknown;
  mov?: unknown;
  range?: unknown;
  healAmount?: unknown;
  role?: unknown;
};

type RawConfig = {
  boardSize?: unknown;
  classes?: Record<string, RawClass>;
};

/**
 * Pure projection from the canonical config shape to the engine's config.
 * The engine never reads files; callers load config.json and project it.
 */
export function projectEngineConfig(raw: RawConfig): GameEngineConfig {
  const boardSize = raw.boardSize as number;
  const classes = raw.classes ?? {};
  const keys: ClassKey[] = ["sword", "axe", "spear", "archer", "mage", "healer"];
  const projected = {} as GameEngineConfig["classes"];
  for (const key of keys) {
    const c = classes[key] ?? {};
    const entry: GameEngineConfig["classes"][ClassKey] = {
      count: c.count as number,
      hp: c.hp as number,
      atk: c.atk as number,
      def: c.def as number,
      mov: c.mov as number,
      range: [...((c.range as number[]) ?? [])],
    };
    if (c.healAmount !== undefined) entry.healAmount = c.healAmount as number;
    if (c.role !== undefined) entry.role = c.role as "attacker" | "supporter";
    projected[key] = entry;
  }
  return { boardSize, classes: projected };
}
