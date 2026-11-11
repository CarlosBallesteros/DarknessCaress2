// The AI-turn prompts (docs/04), as named constants versioned like source.
// The one placeholder is the persona behavior text; every grid reference
// ("15x15", "0-14", rows 13-14 …) is rendered from config.boardSize at
// prompt-build time — prompt hygiene: zero board-size or stat literals.
// Persona BEHAVIOR TEXTS are code constants; config carries only label +
// temperature per personality (the config stays pure data — prose never
// enters it).
import { config } from "../../config/load";
import type { Board, Unit } from "../../game/types";
import { serializeSnapshot } from "./serialize";

const PERSONA_BEHAVIOR_TEXTS: Record<string, string> = {
  aggressive:
    "Hunt them without mercy. Close distance every turn. Concentrate all attacks on one wounded unit until it dies. Attack SUPPORTER units first — the backline the STATS section marks — they're fragile, they matter most, and they die easiest. When no supporter is reachable, hunt the most fragile reachable unit. Do not sit behind the river — you are the attacker.",
  defensive:
    "Fight slowly and survive. Keep your healer 2+ tiles from the front, hold good bridge/forest lines, let them come to you and kill crossing units first. Retreat a wounded front unit backward, it's fine to give ground. Attack from your most favorable range whenever possible — ranged units fire from maximum range.",
  erratic:
    "You are Brilliant but chaotic. Sometimes do something unexpected — split forces, leave a bait, change target for no tactical reason. Commit fully to whatever plan you pick; a chaotic attack is still an attack.",
};

export function personaBehaviorText(personalityId: string): string {
  const text = PERSONA_BEHAVIOR_TEXTS[personalityId];
  if (text === undefined) {
    throw new Error(`no persona behavior text for personality "${personalityId}"`);
  }
  return text;
}

// The system prompt (docs/04), verbatim template.
export function turnSystemPrompt(personalityId: string): string {
  const size = config.boardSize;
  const topRows = "0-1";
  const bottomRows = `${size - 2}-${size - 1}`;
  return `You are the commander of the BLACK army in a turn-based fantasy battle on a ${size}x${size} grid.
Coordinates: x columns 0-${size - 1} (west→east), y rows 0-${size - 1} (north→south).
Your army spawns on the TOP rows (${topRows}); the player's army is on the BOTTOM rows (${bottomRows}).

PERSONA: ${personaBehaviorText(personalityId)}

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
tactics, never legality.
`;
}

// The user message (docs/04): the serialized-state explanation, then the
// literal snapshot, then the ask.
export function turnUserMessage(board: Board, units: Unit[]): string {
  const size = config.boardSize;
  return `BOARD (${size}x${size}): each row is one string of ${size} chars.
  . plain | f forest | h hill | L lake | r rock | ~ river | B bridge
  rows top (y=0) to bottom (y=${size - 1}), chars left (x=0) to right (x=${size - 1})

STATS: one line per class, GENERATED from config at prompt-build time.
  Format, exactly: <class>=hp<hp>/atk<atk>/def<def>/mov<mov>/rng<range>/role<role>
  - rng = the class's config range list rendered comma-joined; an EMPTY list renders
    as rng0 (that class cannot attack).
  - /heal<n> is appended only for classes with a config healAmount —
    always at the END of the line, after /role.
  - role: attacker = melee frontliner; supporter = fragile high-value backline unit —
    the aggressive commander's priority target. Tag semantics are a game decision:
    "supporter" means kill-priority backline, not literal non-combatant (archers and
    mages still attack). Values come from config at build time.
  - one line, classes in config-key order, separated by " | ".

UNITS: BOTH armies, id=class x,y hp/maxHp
  your side = enemy (ids start with "E-"); the player's units (ids "P-…") are your legal targets

${serializeSnapshot(board, units)}

Produce THIS TURN's orders for ALL your surviving units. Reply ONLY with JSON:
{"moves":[{"unitId":"E-…","path":[[x,y],…],"action":{"type":"attack","targetId":"P-…"} | {"type":"heal","targetId":"E-…"} | {"type":"wait"}}]}
- list path as the full walked route from the unit's current tile to its final tile;
  you may list unit orders in any order; omitting a unit means it does NOTHING this
  turn (stays un-acted — equivalent in effect to waiting, but the two are distinct
  paths: an explicit wait marks the unit acted).
- attack targets must be PLAYER units (P-…); heal targets are your own wounded units.
`;
}
