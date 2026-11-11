// The "move N:" prefix (docs/06 endpoint 13): the 1-based index of the
// errored bundle entry ("move 1" = the first entry). applyMoves returns only
// the catalogue message, so the index is re-derived here against the same
// engine — prefix probes locate per-entry failures; the one look-ahead rule
// (a LATER entry claiming an earlier entry's landing tile) is flagged by the
// engine on the EARLIER entry and is identified by its named tile instead.
import { applyMoves } from "../../game/apply";
import { engineConfig } from "../../config/engine";
import type { Board, Move, Unit } from "../../game/types";

export function failedMoveIndex(
  state: { board: Board; units: Unit[] },
  moves: Move[],
  engineError: string,
): number {
  const claim = /^tile \((-?\d+),(-?\d+)\) is claimed by two moves$/.exec(engineError);
  if (claim !== null) {
    const x = Number(claim[1]);
    const y = Number(claim[2]);
    const index = moves.findIndex((move) => {
      const [fx, fy] = move.path[move.path.length - 1];
      return fx === x && fy === y;
    });
    // The error only fires when a move's final tile is the named one.
    return index + 1;
  }
  // Per-entry failures: the full bundle's first failing entry is the first
  // failing prefix length (entries < f validate identically under any
  // prefix — removing later entries can only remove claim conflicts).
  for (let length = 1; length <= moves.length; length++) {
    if (!applyMoves(state, moves.slice(0, length), "player", engineConfig).ok) {
      return length;
    }
  }
  return 1; // unreachable: the error came from a full-bundle run of these moves
}
