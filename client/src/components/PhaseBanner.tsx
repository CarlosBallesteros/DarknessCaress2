import type { GameState, MetaResponse } from "../types/api";
import { PersonaBadge } from "./PersonaBadge";

// Persona label badge (--persona-<id> accent), turn number, status;
// "The darkness is thinking…" pulse when ai_turn (05).
export function PhaseBanner({
  game,
  meta,
}: {
  game: GameState;
  meta: MetaResponse;
}): React.JSX.Element {
  const persona = meta.personalities[game.difficulty];
  const statusText: Record<GameState["status"], string> = {
    generating_board: "The battlefield is being designed…",
    player_turn: "Your turn",
    ai_turn: "The darkness is thinking…",
    won: "Victory",
    lost: "Defeat",
  };
  return (
    <div className={`phase-banner status-${game.status}`}>
      <PersonaBadge personaId={game.difficulty} label={persona?.label ?? game.difficulty} />
      <span className="phase-turn display">Turn {game.turnNumber}</span>
      <span className="phase-status">{statusText[game.status]}</span>
    </div>
  );
}
