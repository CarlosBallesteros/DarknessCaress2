import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGame, forfeit, listGames } from "../api/games";
import { getMeta } from "../api/meta";
import { ApiError } from "../api/request";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PersonaBadge } from "../components/PersonaBadge";
import { usePolling } from "../hooks/usePolling";
import type { GameSummary, GameState, MetaResponse } from "../types/api";
import "../styles/strip.css";

const STATUS_TEXT: Record<GameSummary["status"], string> = {
  player_turn: "Your turn",
  ai_turn: "AI is thinking…",
  won: "Victory",
  lost: "Defeat",
};

function relativeTime(iso: string): string {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - Date.parse(iso)) / 1000),
  );
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en");
}

// "Game" tab home (05): a horizontal scroll-snap strip in creation order —
// game 1 stays leftmost forever; finished games stay in place, dimmed. Last
// tile always = "New battle" card (persona pick modal).
export function GameStrip(): React.JSX.Element {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [forfeitTarget, setForfeitTarget] = useState<GameSummary | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    return listGames()
      .then(setGames)
      .catch((err: unknown) => {
        if (!(err instanceof ApiError && err.status === 401)) {
          setLoadError("The games list is unavailable right now.");
        }
      });
  }, []);

  useEffect(() => {
    void refresh();
    void getMeta()
      .then(setMeta)
      .catch(() => undefined);
  }, [refresh]);

  // Poll every 3 s while any game's status is ai_turn (05).
  usePolling(
    () => {
      void refresh();
    },
    games?.some((g) => g.status === "ai_turn") ?? false,
  );

  if (games === null || meta === null) {
    return (
      <div className="page-loading">
        <span className="spinner" role="status" aria-label="Loading" />
      </div>
    );
  }
  if (loadError !== null) {
    return <p className="error-banner">{loadError}</p>;
  }

  const cap = meta.maxActiveGames;
  const activeCount = games.filter(
    (g) => g.status === "player_turn" || g.status === "ai_turn",
  ).length;
  const atCap = activeCount >= cap;

  const scrollByCards = (delta: number): void => {
    const strip = stripRef.current;
    if (strip !== null) {
      const card = strip.querySelector<HTMLElement>(".strip-card");
      strip.scrollBy({
        left: delta * (card?.offsetWidth ?? 260),
        behavior: "smooth",
      });
    }
  };

  const scrollToCard = (index: number): void => {
    const strip = stripRef.current;
    const card = strip?.querySelectorAll<HTMLElement>(".strip-card")[index];
    if (strip !== null && strip !== undefined && card !== undefined) {
      strip.scrollTo({
        left: card.offsetLeft - strip.offsetLeft,
        behavior: "smooth",
      });
    }
  };

  const openModal = (): void => {
    setModalError(null);
    setModalOpen(true);
  };

  const create = (difficulty: string): void => {
    setCreating(true);
    setModalError(null);
    void createGame(difficulty)
      .then((game: GameState) => navigate(`/play/${game.id}`))
      .catch((err: unknown) => {
        // 503 or any other failure: the server's error string verbatim (05).
        setModalError(
          err instanceof ApiError
            ? err.message
            : "Battlefield generation failed, try again",
        );
        setCreating(false);
      });
  };

  return (
    <section className="strip-page">
      <h1 className="display">Your battles</h1>
      {games.length === 0 ? (
        <div className="strip-empty">
          <button
            type="button"
            className="strip-card new-battle"
            data-testid="new-game"
            onClick={openModal}
          >
            <span className="new-battle-icon" aria-hidden>
              ⚔
            </span>
            New battle
          </button>
          <p className="strip-caption">No battles yet</p>
        </div>
      ) : (
        <>
          <div className="strip-controls">
            <button
              type="button"
              className="icon-btn strip-arrow"
              aria-label="Scroll left"
              onClick={() => scrollByCards(-1)}
            >
              ‹
            </button>
            <div
              className="strip"
              ref={stripRef}
              tabIndex={0}
              role="group"
              aria-label="Your battles"
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") scrollByCards(-1);
                if (e.key === "ArrowRight") scrollByCards(1);
              }}
            >
              {games.map((game) => {
                const finished =
                  game.status === "won" || game.status === "lost";
                return (
                  <div
                    key={game.id}
                    className={`strip-card game-card ${finished ? "card-dimmed" : ""}`}
                    data-testid={`game-card-${game.id}`}
                    onClick={() => navigate(`/play/${game.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") navigate(`/play/${game.id}`);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="card-badges">
                      <PersonaBadge
                        personaId={game.difficulty}
                        label={
                          meta.personalities[game.difficulty]?.label ??
                          game.difficulty
                        }
                      />
                      <span
                        className={`status-badge status-${game.status} ${
                          game.status === "ai_turn" ? "badge-pulse" : ""
                        }`}
                      >
                        {STATUS_TEXT[game.status]}
                      </span>
                    </div>
                    <span className="card-turn display">
                      Turn {game.turnNumber}
                    </span>
                    <span className="card-updated">
                      {relativeTime(game.updatedAt)}
                    </span>
                    {!finished && (
                      <button
                        type="button"
                        className="icon-btn card-menu"
                        aria-label="Card menu"
                        data-testid={`game-menu-${game.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuFor(menuFor === game.id ? null : game.id);
                        }}
                      >
                        ⋮
                      </button>
                    )}
                    {menuFor === game.id && (
                      <div
                        className="card-menu-list"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={undefined}
                      >
                        <button
                          type="button"
                          className="btn btn-danger"
                          data-testid={`forfeit-${game.id}`}
                          onClick={() => {
                            setMenuFor(null);
                            setForfeitTarget(game);
                          }}
                        >
                          Forfeit
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <button
                type="button"
                className="strip-card new-battle"
                data-testid="new-game"
                disabled={atCap}
                title={
                  atCap ? `Limit of ${cap} active games reached` : undefined
                }
                onClick={openModal}
              >
                <span className="new-battle-icon" aria-hidden>
                  ⚔
                </span>
                New battle
              </button>
            </div>
            <button
              type="button"
              className="icon-btn strip-arrow"
              aria-label="Scroll right"
              onClick={() => scrollByCards(1)}
            >
              ›
            </button>
          </div>
          <div className="strip-dots" aria-hidden>
            {games.map((game, index) => (
              <button
                type="button"
                key={game.id}
                className="strip-dot"
                aria-label={`Go to battle ${index + 1}`}
                onClick={() => scrollToCard(index)}
              />
            ))}
          </div>
        </>
      )}

      {modalOpen && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={creating ? undefined : () => setModalOpen(false)}
          onKeyDown={undefined}
        >
          <div
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-label="New battle"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={undefined}
          >
            {creating ? (
              <p className="creating-note" role="status">
                The battlefield is being designed…
              </p>
            ) : (
              <>
                <h2 className="display">New battle</h2>
                <p className="modal-note">Choose your opponent's persona:</p>
                {modalError !== null && (
                  <div className="error-banner" role="alert">
                    {modalError}
                  </div>
                )}
                <div className="persona-options">
                  {Object.entries(meta.personalities).map(([id, persona]) => (
                    <button
                      type="button"
                      key={id}
                      className="btn persona-option"
                      data-testid={`persona-${id}`}
                      onClick={() => create(id)}
                    >
                      <PersonaBadge personaId={id} label={persona.label} />
                    </button>
                  ))}
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setModalOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {forfeitTarget !== null && (
        <ConfirmDialog
          title="Forfeit this battle?"
          body="The battle will be recorded as a defeat."
          confirmLabel="Forfeit"
          cancelLabel="Keep fighting"
          danger
          onCancel={() => setForfeitTarget(null)}
          onConfirm={() => {
            const target = forfeitTarget;
            setForfeitTarget(null);
            void forfeit(target.id)
              .then(() => refresh())
              .catch((err: unknown) => {
                if (err instanceof ApiError) {
                  setLoadError(err.message);
                }
              });
          }}
        />
      )}
    </section>
  );
}
