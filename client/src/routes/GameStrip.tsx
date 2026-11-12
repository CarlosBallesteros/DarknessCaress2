import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createGame, forfeit, listGames } from "../api/games";
import { getMeta } from "../api/meta";
import { ApiError } from "../api/request";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { MiniMap } from "../components/MiniMap";
import { PersonaBadge } from "../components/PersonaBadge";
import { usePolling } from "../hooks/usePolling";
import type { GameSummary, MetaResponse } from "../types/api";
import "../styles/strip.css";

const STATUS_TEXT: Record<GameSummary["status"], string> = {
  generating_board: "Being designed…",
  player_turn: "Your turn",
  ai_turn: "AI is thinking…",
  won: "Victory",
  lost: "Defeat",
};

const PULSING: ReadonlySet<GameSummary["status"]> = new Set(["generating_board", "ai_turn"]);

function relativeTime(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString("en");
}

// Games tab home (05): the Games strip in TWO scroll-snap rows —
// "Active battles" (player_turn/ai_turn) and "Past battles" (won/lost,
// dimmed) — creation order within each row, never reshuffled. New battle is
// NOT a card: an always-visible separate action beside the rows.
export function GameStrip(): React.JSX.Element {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [forfeitTarget, setForfeitTarget] = useState<GameSummary | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);
  const pastRowRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    return listGames()
      .then((next) => {
        setGames(next);
        setLoadError(null);
      })
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

  // Poll every 3 s while ANY game's status is ai_turn OR generating_board
  // (05) — async creation and AI turns share the same convergence promise.
  usePolling(
    () => {
      void refresh();
    },
    games?.some((g) => g.status === "ai_turn" || g.status === "generating_board") ?? false,
  );

  // Close the per-card action menu when clicking outside it.
  useEffect(() => {
    if (menuFor === null) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".card-menu") || target?.closest(".card-menu-list")) return;
      setMenuFor(null);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuFor]);

  if (games === null || meta === null) {
    return (
      <div className="page-loading">
        <span className="spinner" role="status" aria-label="Loading" />
      </div>
    );
  }
  if (loadError !== null) {
    return (
      <div className="page-loading">
        <p className="error-banner">{loadError}</p>
        <button type="button" className="btn" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  }

  const cap = meta.maxActiveGames;
  const active = games.filter(
    (g) => g.status === "generating_board" || g.status === "player_turn" || g.status === "ai_turn",
  );
  const past = games.filter((g) => g.status === "won" || g.status === "lost");
  const atCap = active.length >= cap;

  const scrollRow = (row: HTMLDivElement | null, delta: number): void => {
    if (row === null) {
      return;
    }
    const card = row.querySelector<HTMLElement>(".strip-card");
    row.scrollBy({
      left: delta * (card?.offsetWidth ?? 260),
      behavior: "smooth",
    });
  };

  const openModal = (): void => {
    setModalError(null);
    setModalOpen(true);
  };

  const create = (difficulty: string): void => {
    void createGame(difficulty)
      .then(() => {
        // 05, async creation: the POST answers 202 immediately — the modal
        // closes, the new card joins the Active row ("Being designed…" pulse)
        // and the strip's 3 s polling brings the board to life in place.
        // NO loading lock, NO modal wait. A re-fetch turns the 202 GameState
        // into its GameSummary projection (previewBoard + previewUnits).
        setModalOpen(false);
        void refresh();
      })
      .catch((err: unknown) => {
        // The server's error string verbatim (409 cap, 400 unknown persona).
        setModalError(err instanceof ApiError ? err.message : "Something went wrong.");
      });
  };

  const newBattleButton = (extraClass: string): React.JSX.Element => (
    <button
      type="button"
      className={`btn btn-primary ${extraClass}`}
      data-testid="new-game"
      disabled={atCap}
      title={atCap ? `Limit of ${cap} active games reached` : undefined}
      onClick={openModal}
    >
      New battle
    </button>
  );

  const card = (game: GameSummary): React.JSX.Element => {
    const finished = game.status === "won" || game.status === "lost";
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
            label={meta.personalities[game.difficulty]?.label ?? game.difficulty}
          />
          <span
            className={`status-badge status-${game.status} ${
              PULSING.has(game.status) ? "badge-pulse" : ""
            }`}
          >
            {STATUS_TEXT[game.status]}
          </span>
        </div>
        <MiniMap board={game.previewBoard} previewUnits={game.previewUnits} />
        <div className="card-meta">
          <span className="card-turn display">Turn {game.turnNumber}</span>
          <span className="card-updated">{relativeTime(game.updatedAt)}</span>
        </div>
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
  };

  const row = (
    label: string,
    items: GameSummary[],
    emptyNote: string,
    rowRef: React.RefObject<HTMLDivElement>,
  ): React.JSX.Element => (
    <div className="strip-row-block">
      <h2 className="strip-row-title">{label}</h2>
      <div className="strip-controls">
        <button
          type="button"
          className="icon-btn strip-arrow"
          aria-label={`Scroll ${label} left`}
          onClick={() => scrollRow(rowRef.current, -1)}
        >
          ‹
        </button>
        <div
          className="strip"
          ref={rowRef}
          tabIndex={0}
          role="group"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") scrollRow(rowRef.current, -1);
            if (e.key === "ArrowRight") scrollRow(rowRef.current, 1);
          }}
        >
          {items.length === 0 ? (
            <p className="strip-caption strip-row-empty">{emptyNote}</p>
          ) : (
            items.map(card)
          )}
        </div>
        <button
          type="button"
          className="icon-btn strip-arrow"
          aria-label={`Scroll ${label} right`}
          onClick={() => scrollRow(rowRef.current, 1)}
        >
          ›
        </button>
      </div>
    </div>
  );

  return (
    <section className="strip-page">
      <div className="strip-header">
        <h1 className="display">Your battles</h1>
        <div className="strip-new-battle-wrap">
          {newBattleButton("strip-new-battle")}
          {atCap && (
            <p className="strip-caption strip-cap-note" role="status">
              Limit of {cap} active battles reached. Finish or forfeit a battle to create another.
            </p>
          )}
        </div>
      </div>
      {games.length === 0 ? (
        <div className="strip-empty">
          <p className="strip-caption">No battles yet</p>
        </div>
      ) : (
        <>
          {row("Active battles", active, "No active battles.", activeRowRef)}
          {row("Past battles", past, "No finished battles yet.", pastRowRef)}
        </>
      )}

      {modalOpen && (
        <div
          className="modal-overlay"
          role="presentation"
          onClick={() => setModalOpen(false)}
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
              <button type="button" className="btn" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
            </div>
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
