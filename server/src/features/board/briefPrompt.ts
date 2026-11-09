/**
 * Stage-1 prompt, text verbatim from 03-board-generation.md. The only
 * interpolated values are grid references, rendered from config.boardSize —
 * 04's hygiene rule: config changes must never make a prompt lie. At the
 * baseline boardSize 15 the rendering is exactly the doc's text ("15x15",
 * rows 0-1 / 13-14, ranges 2-12 / 2-11 / 3-11).
 */
export function buildBriefPrompt(boardSize: number): string {
  const top = "0-1";
  const bottom = `${boardSize - 2}-${boardSize - 1}`;
  const riverBound = boardSize - 3;
  const zoneBound = boardSize - 4;
  return `You are a battlefield designer for a small fantasy war game on a ${boardSize}x${boardSize} grid.
Two armies spawn on the BOTTOM rows (${bottom}) and TOP rows (${top}).
Rows ${top} and ${bottom} of every column are RESERVED: no water, no obstacles there.

USUALLY a river runs from the LEFT edge to the RIGHT edge — it must curve if present:
never straight. 1 or 2 bridges cross it when it exists. Hills, forests and a small
lake decorate the terrain. Respond ONLY with JSON matching exactly this shape
("river" may be null for a more rare open-field battlefield):

{
  "river":       <null or {"startRow": int 2-${riverBound}, "endRow": int 2-${riverBound}, "bends": int 1-3}>,
  "bridgeTiles": <integer 1 or 2 — ignored when river is null>,
  "forestZones": <array, 1-3 items: {"centerX": int 2-${riverBound}, "centerY": int 2-${zoneBound}, "radius": int 1-3}>,
  "hillZones":   <array, 0-2 items: {"centerX": int 2-${riverBound}, "centerY": int 2-${riverBound}, "radius": int 1-2}>,
  "lake":        <null or {"centerX": int 2-${riverBound}, "centerY": int 3-${zoneBound}, "radius": int 1-2}>
}

Aim for a varied battlefield; a river crossing is the classic choice.`;
}
