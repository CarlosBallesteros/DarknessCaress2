import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopMenu } from "../components/TopMenu";
import { MiniMap } from "../components/MiniMap";
import { createGame, forfeitGame, listGames } from "../api/games";
import { getMeta } from "../api/meta";
import { usePolling } from "../hooks/usePolling";
import type { GameSummary, Meta } from "../types";
import { ApiError } from "../types";
import "../styles/GameStrip.css";

function statusBadge(status: GameSummary["status"]): { text: string; className: string } {
  switch (status) {
    case "player_turn":
      return { text: "Your turn", className: "badge your-turn" };
    case "ai_turn":
      return { text: "AI is thinking…", className: "badge ai-thinking" };
    case "generating_board":
      return { text: "Being designed…", className: "badge designing" };
    case "won":
      return { text: "Victory", className: "badge victory" };
    case "lost":
      return { text: "Defeat", className: "badge defeat" };
    default:
      return { text: status, className: "badge" };
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.max(0, Math.floor(diff / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function GameStrip() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const [g, m] = await Promise.all([listGames(), getMeta()]);
      setGames(g.games);
      setMeta(m);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load games");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pollingActive = games.some(
    (g) => g.status === "ai_turn" || g.status === "generating_board",
  );
  usePolling(load, pollingActive, 3000);

  const active = useMemo(
    () =>
      games.filter(
        (g) =>
          g.status === "generating_board" || g.status === "player_turn" || g.status === "ai_turn",
      ),
    [games],
  );
  const past = useMemo(
    () => games.filter((g) => g.status === "won" || g.status === "lost"),
    [games],
  );

  const cap = meta?.maxActiveGames ?? 5;
  const atCap = active.length >= cap;

  const onCreate = async (difficulty: string) => {
    setCreating(true);
    setError(null);
    try {
      await createGame({ difficulty });
      setModalOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to create game");
    } finally {
      setCreating(false);
    }
  };

  const onForfeit = async (id: string) => {
    const ok = window.confirm("Forfeit this battle?");
    if (!ok) return;
    try {
      await forfeitGame(id);
      setMenuOpenFor(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to forfeit");
    }
  };

  const personas = meta ? Object.entries(meta.personalities) : [];

  return (
    <main className="page-with-menu">
      <TopMenu />
      <section className="games-strip-page">
        {error ? <div className="error-banner">{error}</div> : null}
        {loading ? <div className="spinner">Loading…</div> : null}
        <div className="strip-header">
          <div>
            <button
              type="button"
              className="new-battle-button"
              data-testid="new-game"
              disabled={atCap}
              title={atCap ? "Limit of 5 active games reached" : "Start a new battle"}
              onClick={() => setModalOpen(true)}
            >
              New battle
            </button>
            {!loading && games.length === 0 ? (
              <p className="empty-caption">No battles yet</p>
            ) : null}
          </div>
        </div>

        {!loading && games.length > 0 ? (
          <>
            <h2 className="strip-row-title">Active battles</h2>
            <div className="strip-row">
              {active.map((g) => {
                const badge = statusBadge(g.status);
                const personaLabel = meta?.personalities[g.difficulty]?.label ?? g.difficulty;
                return (
                  <article
                    key={g.id}
                    className={`game-card active persona-${g.difficulty}`}
                    data-testid={`game-card-${g.id}`}
                  >
                    <button
                      type="button"
                      className="card-focus"
                      onClick={() => navigate(`/play/${g.id}`)}
                    >
                      <MiniMap game={g} />
                    </button>
                    <div className="card-meta">
                      <span className={`persona-badge persona-${g.difficulty}`}>
                        {personaLabel}
                      </span>
                      <span className={badge.className}>{badge.text}</span>
                      <span className="turn-label">Turn {g.turnNumber}</span>
                      <span className="updated-label">{relativeTime(g.updatedAt)}</span>
                    </div>
                    <div className="card-menu-wrap">
                      <button
                        type="button"
                        className="card-menu-btn"
                        aria-label="Game actions"
                        onClick={() => setMenuOpenFor(menuOpenFor === g.id ? null : g.id)}
                      >
                        ⋮
                      </button>
                      {menuOpenFor === g.id ? (
                        <div className="card-menu">
                          <button
                            type="button"
                            data-testid="forfeit"
                            onClick={() => void onForfeit(g.id)}
                          >
                            Forfeit
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>

            <h2 className="strip-row-title">Past battles</h2>
            <div className="strip-row past">
              {past.map((g) => {
                const badge = statusBadge(g.status);
                const personaLabel = meta?.personalities[g.difficulty]?.label ?? g.difficulty;
                return (
                  <article
                    key={g.id}
                    className={`game-card past persona-${g.difficulty}`}
                    data-testid={`game-card-${g.id}`}
                  >
                    <button
                      type="button"
                      className="card-focus"
                      onClick={() => navigate(`/play/${g.id}`)}
                    >
                      <MiniMap game={g} />
                    </button>
                    <div className="card-meta">
                      <span className={`persona-badge persona-${g.difficulty}`}>
                        {personaLabel}
                      </span>
                      <span className={badge.className}>{badge.text}</span>
                      <span className="turn-label">Turn {g.turnNumber}</span>
                      <span className="updated-label">{relativeTime(g.updatedAt)}</span>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : null}
      </section>

      {modalOpen ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2>New battle</h2>
            <p>Choose a difficulty:</p>
            <div className="persona-choices">
              {personas.map(([id, p]) => (
                <button
                  key={id}
                  type="button"
                  data-testid={`persona-${id}`}
                  className={`persona-choice persona-${id}`}
                  disabled={creating}
                  onClick={() => void onCreate(id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => setModalOpen(false)}
              disabled={creating}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
