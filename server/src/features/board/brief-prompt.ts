// Stage 1 prompt (docs/03), verbatim — the only values swapped in are the
// board-size-derived numbers, rendered from config.boardSize at prompt-build
// time ("15x15", spawn rows "13-14"/"0-1" and the schema ranges at baseline).
// Prompt hygiene (docs/04): zero board-size literals live in this template.
import { config } from "../../config/config";

export function briefPrompt(): string {
  const size = config.boardSize;
  const grid = `${size}x${size}`;
  const topRows = `0-1`;
  const bottomRows = `${size - 2}-${size - 1}`;
  const rowMin = 2;
  const rowMax = size - 3; // river rows: 2-12 at baseline
  const colMax = size - 3; // zone centerX: 2-12 at baseline
  const forestRowMax = size - 4; // forest centerY: 2-11 at baseline
  const lakeRowMax = size - 4; // lake centerY: 3-11 at baseline

  return `You are a battlefield designer for a small fantasy war game on a ${grid} grid.
Two armies spawn on the BOTTOM rows (${bottomRows}) and TOP rows (${topRows}).
Rows ${topRows} and ${bottomRows} of every column are RESERVED: no water, no obstacles there.

USUALLY a river runs from the LEFT edge to the RIGHT edge — it must curve if present:
never straight. 1 or 2 bridges cross it when it exists. Hills, forests and a small
lake decorate the terrain. Respond ONLY with JSON matching exactly this shape
("river" may be null for a more rare open-field battlefield):

{
  "river":       <null or {"startRow": int ${rowMin}-${rowMax}, "endRow": int ${rowMin}-${rowMax}, "bends": int 1-3}>,
  "bridgeTiles": <integer 1 or 2 — ignored when river is null>,
  "forestZones": <array, 1-3 items: {"centerX": int ${rowMin}-${colMax}, "centerY": int ${rowMin}-${forestRowMax}, "radius": int 1-3}>,
  "hillZones":   <array, 0-2 items: {"centerX": int ${rowMin}-${colMax}, "centerY": int ${rowMin}-${rowMax}, "radius": int 1-2}>,
  "lake":        <null or {"centerX": int ${rowMin}-${colMax}, "centerY": int 3-${lakeRowMax}, "radius": int 1-2}>
}

Aim for a varied battlefield; a river crossing is the classic choice.
`;
}
