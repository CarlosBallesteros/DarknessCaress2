// Which 1-based bundle entry produced the engine's rejection (docs/06
// endpoint 13's "move 1: …" prefix). The engine returns only the message, so
// the smallest prefix that fails with THAT exact message is the failing
// entry — prefix N is the full bundle, so the index always exists. Prefixes
// can fail EARLIER with a different message than the whole bundle (an
// execution-time failure before a later static one), which is why equality
// with the bundle's own verdict is required, not first failure.
import { applyMoves } from "../../game/apply";
import type { Board, GameEngineConfig, Move, Unit } from "../../game/types";

export function failingMoveIndex(
  state: { board: Board; units: Unit[] },
  moves: Move[],
  engineError: string,
  engineCfg: GameEngineConfig,
): number {
  for (let count = 1; count <= moves.length; count++) {
    const prefix = applyMoves(
      state,
      moves.slice(0, count),
      "player",
      engineCfg,
    );
    if (!prefix.ok && prefix.error === engineError) {
      return count;
    }
  }
  return moves.length;
}
