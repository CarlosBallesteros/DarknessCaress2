interface TurnFooterProps {
  onEndTurn: () => void;
  onForfeit: () => void;
}

// [End turn] primary, ALWAYS enabled (uniform choreography — 05); [Forfeit].
export function TurnFooter({ onEndTurn, onForfeit }: TurnFooterProps): React.JSX.Element {
  return (
    <div className="turn-footer">
      <button type="button" className="btn btn-primary" data-testid="end-turn" onClick={onEndTurn}>
        End turn
      </button>
      <button type="button" className="btn btn-danger" data-testid="forfeit" onClick={onForfeit}>
        Forfeit
      </button>
    </div>
  );
}
