// The STATS block (docs/04): the sole config-derived part of the AI-turn
// prompt, emitted by this one shared helper. Format, exactly:
// `<class>=hp<hp>/atk<atk>/def<def>/mov<mov>/rng<range>/role<role>[heal<n>]`,
// one line, classes in config-key order, separated by " | ". An EMPTY range
// list renders as rng0 (that class cannot attack); /heal<n> is appended only
// for classes with a config healAmount, always at the END after /role. Zero
// stat literals live anywhere else — rebalancing the config re-renders this.
import type { GameConfig } from "../../config/config";

export function statsKernel(cfg: Pick<GameConfig, "classes">): string {
  return Object.entries(cfg.classes)
    .map(([key, stats]) => {
      const range = stats.range.length > 0 ? stats.range.join(",") : "0";
      const heal =
        stats.healAmount !== undefined ? `/heal${stats.healAmount}` : "";
      return `${key}=hp${stats.hp}/atk${stats.atk}/def${stats.def}/mov${stats.mov}/rng${range}/role-${stats.role}${heal}`;
    })
    .join(" | ");
}
