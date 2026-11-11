// The AI-turn prompts (docs/04), transcribed verbatim from the doc's rendered
// baseline. The only swapped values are the board-size-derived numbers —
// "15x15", "0-14", "(13-14)" are regenerated from config.boardSize at
// prompt-build time and never hand-edited; the RULES DIGEST itself is
// class-agnostic and fixed. The STATS line is emitted by the one shared
// helper (stats-kernel) so a config rebalance can never make a prompt lie.
import type { GameConfig } from "../../config/config";
import type { Board, Unit } from "../../game/types";
import { serializeState } from "./serialize";
import { statsKernel } from "./stats-kernel";

export function buildTurnSystemPrompt(
  behaviorText: string,
  boardSize: number,
): string {
  const last = boardSize - 1;
  const playerFront = boardSize - 2;
  return `You are the commander of the BLACK army in a turn-based fantasy battle on a ${boardSize}x${boardSize} grid.
Coordinates: x columns 0-${last} (west→east), y rows 0-${last} (north→south).
Your army spawns on the TOP rows (0-1); the player's army is on the BOTTOM rows (${playerFront}-${last}).

PERSONA: ${behaviorText}

RULES DIGEST:
- Each of your units once per turn: move up to its MOV tiles (4-neighbor path, cannot
  cross water except bridges, cannot finish on an occupied tile, cannot pass through
  enemy units), then ONE action.
- Actions: attack (only if Manhattan distance |dx|+|dy| from the final tile is within the
  unit's class RANGE — per-class values are in the STATS section — Manhattan = orthogonal
  steps walked, e.g. 2 tiles straight, or 1 forward + 1 sideways; diagonal offsets are 2,
  never 1), heal (healer only, adjacent ally below max HP), or wait.
- RANGE lists may skip distances: a unit attacks ONLY at the listed values (a range list
  written "[2]" means exactly 2 — distance 1 is illegal, distance 3 is illegal).
- Combat: damage = attacker's ATK − target's DEF (min 0). The defender counters
  automatically if your unit ends inside ITS range — killed units never counter.
  A dead unit is removed. Low-DEF units die in just a few hits — keep them protected.
- You win by destroying every enemy unit. Your units are the ones whose ids start with "E-".
- Units already eliminated are not in the state. Out-of-range attacks are illegal.

Above all else: be reliable about attack-range legality; your persona shapes
tactics, never legality.`;
}

// The user message (docs/04): the format legend (glyphs + the config-rendered
// STATS line + the UNITS legend), then the literal serialized snapshot, then
// the ask. Compact over verbose — nothing here is duplicated in the system
// prompt.
export function buildTurnUserMessage(
  board: Board,
  units: Unit[],
  cfg: Pick<GameConfig, "boardSize" | "classes">,
): string {
  const last = cfg.boardSize - 1;
  const legend = `BOARD (${cfg.boardSize}x${cfg.boardSize}): each row is one string of ${cfg.boardSize} chars.
  . plain | f forest | h hill | L lake | r rock | ~ river | B bridge
  rows top (y=0) to bottom (y=${last}), chars left (x=0) to right (x=${last})`;
  const unitsLegend = `UNITS: BOTH armies, id=class x,y hp/maxHp
  your side = enemy (ids start with "E-"); the player's units (ids "P-…") are your legal targets`;
  const ask = `Produce THIS TURN's orders for ALL your surviving units. Reply ONLY with JSON:
{"moves":[{"unitId":"E-…","path":[[x,y],…],"action":{"type":"attack","targetId":"P-…"} | {"type":"heal","targetId":"E-…"} | {"type":"wait"}}]}
- list \`path\` as the full walked route from the unit's current tile to its final tile;
  you may list unit orders in any order; omitting a unit means it does NOTHING this
  turn (stays un-acted — equivalent in effect to waiting, but the two are distinct
  paths: an explicit wait marks the unit acted).
- attack targets must be PLAYER units (P-…); heal targets are your own wounded units.`;
  return `${legend}\n\nSTATS: ${statsKernel(cfg)}\n\n${unitsLegend}\n\n${serializeState(board, units)}\n\n${ask}`;
}
