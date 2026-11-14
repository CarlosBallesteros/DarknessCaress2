import type { AppConfig } from "../../config";

export function buildBriefPrompt(config: Pick<AppConfig, "boardSize">): string {
  const size = config.boardSize;
  const topStart = 0;
  const topEnd = 1;
  const bottomStart = size - 2;
  const bottomEnd = size - 1;
  const riverRowMin = 2;
  const riverRowMax = size - 3;

  return [
    `You are a battlefield designer for a small fantasy war game on a ${size}x${size} grid.`,
    `Two armies spawn on the BOTTOM rows (${bottomStart}-${bottomEnd}) and TOP rows (${topStart}-${topEnd}).`,
    `Rows ${topStart}-${topEnd} and ${bottomStart}-${bottomEnd} of every column are RESERVED: no water, no obstacles there.`,
    "",
    "USUALLY a river runs from the LEFT edge to the RIGHT edge — it must curve if present:",
    "never straight. 1 or 2 bridges cross it when it exists. Hills, forests and a small",
    "lake decorate the terrain. Respond ONLY with JSON matching exactly this shape",
    '("river" may be null for a more rare open-field battlefield):',
    "",
    "{",
    `  "river":       <null or {"startRow": int ${riverRowMin}-${riverRowMax}, "endRow": int ${riverRowMin}-${riverRowMax}, "bends": int 1-3}>,`,
    '  "bridgeTiles": <integer 1 or 2 — ignored when river is null>,',
    `  "forestZones": <array, 1-3 items: {"centerX": int 2-${size - 3}, "centerY": int 2-${size - 4}, "radius": int 1-3}>,`,
    `  "hillZones":   <array, 0-2 items: {"centerX": int 2-${size - 3}, "centerY": int 2-${size - 3}, "radius": int 1-2}>,`,
    `  "lake":        <null or {"centerX": int 2-${size - 3}, "centerY": int 3-${size - 4}, "radius": int 1-2}>`,
    "}",
    "",
    "Aim for a varied battlefield; a river crossing is the classic choice.",
  ].join("\n");
}
