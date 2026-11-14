import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopMenu } from "../components/TopMenu";
import { ConfirmModal } from "../components/ConfirmModal";
import { usePolling } from "../hooks/usePolling";
import { createGame, forfeitGame, listGames } from "../api/games";
import { getMeta } from "../api/meta";
import { ApiError } from "../api/request";
import type { GameSummary, Meta } from "../types";
import "../styles/GameStrip.css";

function statusLabel(status: GameSummary["status"]): string {
  if (status === "player_turn") return "Your turn";
  if (status === "ai_turn") return "AI is thinking…";
  if (status === "generating_board") return "Being designed…";
  if (status === "won") return "Victory";
  return "Defeat";
}

function statusClass(status: GameSummary["status"]): string {
  if (status === "player_turn") return "status-player";
  if (status === "ai_turn") return "status-ai";
  if (status === "generating_board") return "status-gen";
  if (status === "won") return "status-won";
  return "status-lost";
}

function tileColor(tile: string): string {
  switch (tile) {
    case "forest":
      return "var(--tile-forest)";
    case "hill":
      return "var(--tile-hill)";
    case "lake":
      return "var(--tile-lake)";
    case "river":
      return "var(--tile-river)";
    case "bridge":
      return "var(--tile-bridge)";
    case "rock":
      return "var(--tile-rock)";
    default:
      return "var(--tile-plain)";
  }
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diff / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function MiniMap({ game }: { game: GameSummary }) {
  const tiles = game.previewBoard.tiles;
  const size = tiles.length || 8;
  return (
    <div
      className="mini-map"
      style={{ gridTemplateColumns: `repeat(${size}, 1fr)` }}
      aria-hidden="true"
    >
      {tiles.flatMap((row, y) =>
        row.map((tile, x) => (
          <div key={`${x}-${y}`} className="mini-tile" style={{ background: tileColor(tile) }} />
        )),
      )}
      {game.previewUnits.map((u, i) => (
        <div
          key={i}
          className={`mini-dot ${u.side}`}
          style={{
            left: `calc((100% / ${size}) * ${u.x} + (100% / ${size}) * 0.2)`,
            top: `calc((100% / ${size}) * ${u.y} + (100% / ${size}) * 0.2)`,
            width: `calc((100% / ${size}) * 0.6)`,
            height: `calc((100% / ${size}) * 0.6)`,
          }}
        />
      ))}
    </div>
  );
}

function WindowedRow({
  title,
  games,
  emptyLabel,
  dimmed,
  personaLabels,
  onOpen,
  onForfeit,
}: {
  title: string;
  games: GameSummary[];
  emptyLabel: string;
  dimmed?: boolean;
  personaLabels: Record<string, string>;
  onOpen: (id: string) => void;
  onForfeit: (id: string) => void;
}) {
  const [start, setStart] = useState(0);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const visible = games.slice(start, start + 3);
  const canLeft = start > 0;
  const canRight = start + 3 < games.length;

  return (
    <section className="strip-section">
      <h2>{title}</h2>
      <div className="windowed-row">
        <button
          type="button"
          className="window-arrow"
          onClick={() => setStart((s) => Math.max(0, s - 1))}
          disabled={!canLeft}
          aria-label="Show previous games"
        >
          ◀
        </button>
        <div className="window-cards">
          {games.length === 0 ? (
            <div className="empty-row card">{emptyLabel}</div>
          ) : (
            visible.map((game) => {
              const active =
                game.status === "generating_board" ||
                game.status === "player_turn" ||
                game.status === "ai_turn";
              return (
                <article
                  key={game.id}
                  className={`game-card card ${dimmed ? "dimmed" : ""}`}
                  data-testid={`game-card-${game.id}`}
                  onClick={() => onOpen(game.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") onOpen(game.id);
                  }}
                >
                  <div className="card-top">
                    <span className={`persona-badge persona-${game.difficulty}`}>
                      {personaLabels[game.difficulty] ?? game.difficulty}
                    </span>
                    <span className={`status-badge ${statusClass(game.status)}`}>
                      {statusLabel(game.status)}
                    </span>
                  </div>
                  <MiniMap game={game} />
                  <div className="card-meta">
                    <span>Turn {game.turnNumber}</span>
                    <span>{relativeTime(game.updatedAt)}</span>
                  </div>
                  {active ? (
                    <div className="card-menu-wrap" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="card-menu-btn"
                        aria-label="Game actions"
                        onClick={() => setMenuOpenId((id) => (id === game.id ? null : game.id))}
                      >
                        ⋮
                      </button>
                      {menuOpenId === game.id ? (
                        <div className="card-menu">
                          <button
                            type="button"
                            className="card-menu-item"
                            onClick={() => {
                              setMenuOpenId(null);
                              onForfeit(game.id);
                            }}
                          >
                            Forfeit
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
        <button
          type="button"
          className="window-arrow"
          onClick={() => setStart((s) => Math.min(Math.max(0, games.length - 3), s + 1))}
          disabled={!canRight}
          aria-label="Show next games"
        >
          ▶
        </button>
      </div>
    </section>
  );
}

export function GameStrip() {
  const navigate = useNavigate();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [forfeitId, setForfeitId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  usePolling(
    () => {
      void listGames()
        .then((g) => setGames(g.games))
        .catch(() => {});
    },
    games.some((g) => g.status === "ai_turn" || g.status === "generating_board"),
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [g, m] = await Promise.all([listGames(), getMeta()]);
        if (cancelled) return;
        setGames(g.games);
        setMeta(m);
      } catch {
        // global 401 handling applies; ignore others
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const personaLabels = useMemo(() => {
    const out: Record<string, string> = {};
    if (meta) {
      for (const [id, p] of Object.entries(meta.personalities)) out[id] = p.label;
    }
    return out;
  }, [meta]);

  const active = useMemo(
    () =>
      games.filter(
        (g) =>
          g.status === "generating_board" || g.status === "player_turn" || g.status === "ai_turn",
      ),
    [games],
  );
  const past = useMemo(() => {
    const finished = games.filter((g) => g.status === "won" || g.status === "lost");
    // newest finished first (left to right). games list is creation order asc; reverse gives newest created last -> first.
    return [...finished].reverse();
  }, [games]);

  const cap = meta?.maxActiveGames ?? 5;
  const activeCount = active.length;
  const canCreate = activeCount < cap;

  const onCreate = async (difficulty: string) => {
    if (!canCreate) return;
    setCreating(true);
    setError(null);
    try {
      await createGame({ difficulty });
      setNewOpen(false);
      const g = await listGames();
      setGames(g.games);
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError("Failed to create game");
    } finally {
      setCreating(false);
    }
  };

  const onConfirmForfeit = async () => {
    if (!forfeitId) return;
    try {
      await forfeitGame(forfeitId);
      const g = await listGames();
      setGames(g.games);
    } finally {
      setForfeitId(null);
    }
  };

  return (
    <div className="page-shell">
      <TopMenu />
      <main className="page-content games-page">
        {error ? <div className="error-banner">{error}</div> : null}
        <div className="games-layout">
          <div className="games-rows">
            <WindowedRow
              title="Active battles"
              games={active}
              emptyLabel="No active battles"
              personaLabels={personaLabels}
              onOpen={(id) => navigate(`/play/${id}`)}
              onForfeit={(id) => setForfeitId(id)}
            />
            <WindowedRow
              title="Past battles"
              games={past}
              emptyLabel="No past battles"
              dimmed
              personaLabels={personaLabels}
              onOpen={(id) => navigate(`/play/${id}`)}
              onForfeit={() => {}}
            />
          </div>
          <div className="new-battle-panel">
            <button
              type="button"
              className="primary-btn new-battle-btn"
              data-testid="new-game"
              onClick={() => setNewOpen(true)}
              disabled={!canCreate}
              title={!canCreate ? "Limit of 5 active games reached" : "Start a new battle"}
            >
              New battle
            </button>
            {!canCreate ? <div className="cap-note">Limit of 5 active games reached</div> : null}
          </div>
        </div>
      </main>

      {newOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => !creating && setNewOpen(false)}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Choose your opponent</h3>
            <div className="persona-choices">
              <button
                type="button"
                className="persona-choice persona-aggressive"
                data-testid="persona-aggressive"
                disabled={creating}
                onClick={() => void onCreate("aggressive")}
              >
                Aggressive
              </button>
              <button
                type="button"
                className="persona-choice persona-defensive"
                data-testid="persona-defensive"
                disabled={creating}
                onClick={() => void onCreate("defensive")}
              >
                Cowardly
              </button>
              <button
                type="button"
                className="persona-choice persona-erratic"
                data-testid="persona-erratic"
                disabled={creating}
                onClick={() => void onCreate("erratic")}
              >
                Crazy
              </button>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setNewOpen(false)}
                disabled={creating}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={!!forfeitId}
        title="Forfeit battle?"
        body={<p>This battle will be counted as a loss.</p>}
        cancelLabel="Cancel"
        confirmLabel="Forfeit"
        danger
        onCancel={() => setForfeitId(null)}
        onConfirm={() => void onConfirmForfeit()}
      />
    </div>
  );
}
