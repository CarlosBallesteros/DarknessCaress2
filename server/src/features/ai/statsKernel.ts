// The STATS block (docs/04): the sole config-derived part of the prompt
// system, emitted by this one shared helper. Format, exactly:
//   <class>=hp<hp>/atk<atk>/def<def>/mov<mov>/rng<range>/role<role>
// rng renders comma-joined (an EMPTY list renders as rng0 — that class cannot
// attack); /heal<n> is appended only for classes with a config healAmount,
// always at the END of the line, after /role. One line, classes in
// config-key order, separated by " | ". Zero stat literals live anywhere else
// — rebalancing the config can never make a prompt lie.
import type { GameConfig } from "../../config/load";

export function statsKernel(cfg: GameConfig): string {
  return Object.entries(cfg.classes)
    .map(([key, cls]) => {
      const rng = cls.range.length > 0 ? cls.range.join(",") : "0";
      const heal = cls.healAmount !== undefined ? `/heal${cls.healAmount}` : "";
      return `${key}=hp${cls.hp}/atk${cls.atk}/def${cls.def}/mov${cls.mov}/rng${rng}/role-${cls.role}${heal}`;
    })
    .join(" | ");
}
