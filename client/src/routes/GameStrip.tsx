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
  const [forfeitId, setForfeitId] = useState<string | null>(null);
  const [forfeiting, setForfeiting] = useState(false);
  const [activeStart, setActiveStart] = useState(0);
  const [pastStart, setPastStart] = useState(0);
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

  useEffect(() => {
    setActiveStart((s) => Math.min(s, Math.max(0, active.length - 3)));
  }, [active.length]);
  useEffect(() => {
    setPastStart((s) => Math.min(s, Math.max(0, past.length - 3)));
  }, [past.length]);

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

  const requestForfeit = (id: string) => {
    setMenuOpenFor(null);
    setForfeitId(id);
  };

  const confirmForfeit = async () => {
    if (!forfeitId) return;
    setForfeiting(true);
    setError(null);
    try {
      await forfeitGame(forfeitId);
      setForfeitId(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to forfeit");
    } finally {
      setForfeiting(false);
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
          </div>
        </div>

        {!loading ? (
          <>
            <h2 className="strip-row-title">Active battles</h2>
            {active.length > 0 ? (
              <div className="strip-window">
                {activeStart > 0 ? (
                  <button
                    type="button"
                    className="strip-arrow left"
                    aria-label="Show previous active battles"
                    onClick={() => setActiveStart((s) => Math.max(0, s - 1))}
                  >
                    ‹
                  </button>
                ) : (
                  <span className="strip-arrow-spacer" aria-hidden="true" />
                )}
                <div className="strip-row">
                  {active.slice(activeStart, activeStart + 3).map((g) => {
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
                            onClick={(e) => {
                              e.stopPropagation();
                              setMenuOpenFor(menuOpenFor === g.id ? null : g.id);
                            }}
                          >
                            ⋮
                          </button>
                          {menuOpenFor === g.id ? (
                            <div className="card-menu">
                              <button
                                type="button"
                                data-testid="forfeit"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  requestForfeit(g.id);
                                }}
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
                {activeStart + 3 < active.length ? (
                  <button
                    type="button"
                    className="strip-arrow right"
                    aria-label="Show next active battles"
                    onClick={() => setActiveStart((s) => Math.min(active.length - 3, s + 1))}
                  >
                    ›
                  </button>
                ) : (
                  <span className="strip-arrow-spacer" aria-hidden="true" />
                )}
              </div>
            ) : (
              <p className="strip-empty">No active battles</p>
            )}

            <h2 className="strip-row-title">Past battles</h2>
            {past.length > 0 ? (
              <div className="strip-window">
                {pastStart > 0 ? (
                  <button
                    type="button"
                    className="strip-arrow left"
                    aria-label="Show previous past battles"
                    onClick={() => setPastStart((s) => Math.max(0, s - 1))}
                  >
                    ‹
                  </button>
                ) : (
                  <span className="strip-arrow-spacer" aria-hidden="true" />
                )}
                <div className="strip-row past">
                  {past.slice(pastStart, pastStart + 3).map((g) => {
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
                {pastStart + 3 < past.length ? (
                  <button
                    type="button"
                    className="strip-arrow right"
                    aria-label="Show next past battles"
                    onClick={() => setPastStart((s) => Math.min(past.length - 3, s + 1))}
                  >
                    ›
                  </button>
                ) : (
                  <span className="strip-arrow-spacer" aria-hidden="true" />
                )}
              </div>
            ) : (
              <p className="strip-empty">No past battles</p>
            )}
          </>
        ) : null}
      </section>

      {modalOpen ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !creating) {
              setModalOpen(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !creating) {
              setModalOpen(false);
            }
          }}
          tabIndex={-1}
        >
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
      {forfeitId ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !forfeiting) {
              setForfeitId(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !forfeiting) {
              setForfeitId(null);
            }
          }}
          tabIndex={-1}
        >
          <div className="modal">
            <h2>Forfeit battle?</h2>
            <p>This battle will be counted as a loss.</p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setForfeitId(null)}
                disabled={forfeiting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="danger"
                data-testid="forfeit-confirm"
                onClick={() => void confirmForfeit()}
                disabled={forfeiting}
              >
                Forfeit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
