import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { TopMenu } from "../components/TopMenu";
import { ConfirmModal } from "../components/ConfirmModal";
import { usePolling } from "../hooks/usePolling";
import { endTurn, forfeitGame, getGame, getPreview, submitMoves } from "../api/games";
import { getMeta } from "../api/meta";
import { ApiError } from "../api/request";
import { assetPath } from "../lib/assetPath";
import { computeDisplayPath, manhattan, type Point } from "../lib/pathDisplay";
import { canSelectPlayerUnit, initialBoardUiState, stagedMovesReducer } from "../state/stagedMoves";
import type { ClassKey, GameState, Meta, MoveBundle, Unit } from "../types";
import "../styles/GameBoard.css";

const CLASS_ORDER: ClassKey[] = ["sword", "axe", "spear", "archer", "mage", "healer"];

function classOrderIndex(key: ClassKey): number {
  const i = CLASS_ORDER.indexOf(key);
  return i === -1 ? 999 : i;
}

function tileClass(tile: string): string {
  switch (tile) {
    case "forest":
      return "tile-forest";
    case "hill":
      return "tile-hill";
    case "lake":
      return "tile-lake";
    case "river":
      return "tile-river";
    case "bridge":
      return "tile-bridge";
    case "rock":
      return "tile-rock";
    default:
      return "tile-plain";
  }
}

function unitLabel(unit: Unit, meta: Meta | null): string {
  const base = meta?.classes[unit.class]?.label ?? unit.class;
  const n = unit.id.split("-").pop();
  return n ? `${base} #${n}` : base;
}

function parseMoveErrorIndex(message: string): number | null {
  const m = /^move\s+(\d+):/i.exec(message);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n - 1 : null;
}

export function GameBoard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [game, setGame] = useState<GameState | null>(null);
  const [ui, dispatch] = useReducer(stagedMovesReducer, initialBoardUiState);
  const [loading, setLoading] = useState(true);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showForfeitConfirm, setShowForfeitConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [endTurnBusy, setEndTurnBusy] = useState(false);
  const [replayLock, setReplayLock] = useState(false);
  const replayToken = useRef(0);
  const prevStatus = useRef<GameState["status"] | null>(null);
  const prevLastAi = useRef<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!id) return;
    const [g, m] = await Promise.all([getGame(id), meta ? Promise.resolve(meta) : getMeta()]);
    setGame(g.game);
    if (!meta) setMeta(m);
  }, [id, meta]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadAll();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadAll]);

  // polling while ai_turn or generating_board
  usePolling(
    () => {
      if (!id || replayLock) return;
      void getGame(id)
        .then((res) => setGame(res.game))
        .catch(() => {});
    },
    !!game && (game.status === "ai_turn" || game.status === "generating_board") && !replayLock,
    3000,
  );

  // replay on transition to player_turn with new lastAiActions
  useEffect(() => {
    if (!game) return;
    const lastKey = game.lastAiActions ? JSON.stringify(game.lastAiActions) : null;
    const becamePlayerTurn = prevStatus.current === "ai_turn" && game.status === "player_turn";
    const hasNewActions = !!lastKey && lastKey !== prevLastAi.current;
    if (becamePlayerTurn && hasNewActions && game.lastAiActions && game.lastAiActions.length > 0) {
      replayToken.current += 1;
      const token = replayToken.current;
      setReplayLock(true);
      const total = game.lastAiActions.length * 120 + 120;
      window.setTimeout(() => {
        if (replayToken.current === token) {
          setReplayLock(false);
        }
      }, total);
    } else if (game.status !== "player_turn" || !hasNewActions) {
      // ensure lock not stuck
      if (game.status !== "ai_turn") setReplayLock(false);
    }
    prevStatus.current = game.status;
    prevLastAi.current = lastKey;
  }, [game]);

  useEffect(() => {
    return () => {
      replayToken.current += 1;
      setReplayLock(false);
    };
  }, []);

  const themeId = (meta?.themes[0]?.id ?? "warriors-europe") as string;

  const unitsById = useMemo(() => {
    const map = new Map<string, Unit>();
    for (const u of game?.units ?? []) map.set(u.id, u);
    return map;
  }, [game]);

  const stagedUnitIds = useMemo(
    () => new Set(ui.stagedMoves.map((m) => m.unitId)),
    [ui.stagedMoves],
  );

  const boardSize = meta?.boardSize ?? game?.board.tiles.length ?? 8;
  const tiles =
    game?.board.tiles ??
    Array.from({ length: boardSize }, () => Array.from({ length: boardSize }, () => "plain"));

  const isBoardInteractive =
    game?.status === "player_turn" && !submitting && !endTurnBusy && !replayLock;

  const trayUnits = useMemo(() => {
    const player = (game?.units ?? []).filter((u) => u.side === "player");
    return [...player].sort((a, b) => {
      const oa = classOrderIndex(a.class);
      const ob = classOrderIndex(b.class);
      if (oa !== ob) return oa - ob;
      return a.id.localeCompare(b.id);
    });
  }, [game]);

  const selectedUnit = ui.selectedUnitId ? (unitsById.get(ui.selectedUnitId) ?? null) : null;
  const inspectUnit = ui.inspectUnitId ? (unitsById.get(ui.inspectUnitId) ?? null) : null;

  const preview = ui.preview;

  const effectiveMoveTiles = preview?.moveTiles ?? [];
  const effectiveAttackTilesBase = preview?.attackTiles ?? [];
  const effectiveHealTilesBase = preview?.healTiles ?? [];

  const actionableAttackTiles = useMemo(() => {
    if (!game || !meta || !preview) return [] as [number, number][];
    if (ui.mode === "movePicked" && ui.pickedDestination && selectedUnit) {
      const ranges = meta.classes[selectedUnit.class]?.range ?? [];
      return effectiveAttackTilesBase.filter((t) => {
        const enemy = (game.units ?? []).find(
          (u) => u.side === "enemy" && u.x === t[0] && u.y === t[1],
        );
        if (!enemy) return false;
        return ranges.includes(manhattan(ui.pickedDestination as Point, [enemy.x, enemy.y]));
      });
    }
    return effectiveAttackTilesBase;
  }, [game, meta, preview, ui.mode, ui.pickedDestination, selectedUnit, effectiveAttackTilesBase]);

  const actionableHealTiles = useMemo(() => {
    if (!game || !preview) return [] as [number, number][];
    if (selectedUnit?.class !== "healer") return [] as [number, number][];
    if (ui.mode === "movePicked" && ui.pickedDestination) {
      // allies adjacent to chosen destination, wounded
      return (game.units ?? [])
        .filter(
          (u) =>
            u.side === "player" &&
            u.hp < u.maxHp &&
            manhattan([u.x, u.y], ui.pickedDestination as Point) === 1,
        )
        .map((u) => [u.x, u.y] as [number, number]);
    }
    return effectiveHealTilesBase;
  }, [game, preview, ui.mode, ui.pickedDestination, selectedUnit, effectiveHealTilesBase]);

  const onSelectUnit = async (unit: Unit) => {
    if (!id || !game || !isBoardInteractive) return;
    setBannerError(null);
    try {
      const p = await getPreview(id, unit.id);
      if (unit.side === "enemy") {
        dispatch({ type: "inspectEnemy", unitId: unit.id, preview: p });
      } else {
        if (!canSelectPlayerUnit(unit, ui)) return;
        dispatch({ type: "selectOwnUnit", unitId: unit.id, preview: p });
      }
    } catch (err) {
      if (err instanceof ApiError) setBannerError(err.message);
    }
  };

  const tryStageAttackFromCurrent = (enemy: Unit): boolean => {
    if (!selectedUnit || !preview || ui.mode !== "unitSelected") return false;
    const here: [number, number] = [selectedUnit.x, selectedUnit.y];
    const canHit = actionableAttackTiles.some((t) => t[0] === enemy.x && t[1] === enemy.y);
    // allowed if target reachable from current tile and in preview attackTiles and within class range from current
    if (!canHit) return false;
    if (!meta) return false;
    const ranges = meta.classes[selectedUnit.class]?.range ?? [];
    if (!ranges.includes(manhattan(here, [enemy.x, enemy.y]))) return false;
    const move: MoveBundle = {
      unitId: selectedUnit.id,
      path: [here],
      action: { type: "attack", targetId: enemy.id },
    };
    dispatch({ type: "stageMove", move });
    return true;
  };

  const tryStageHealFromCurrent = (ally: Unit): boolean => {
    if (!selectedUnit || selectedUnit.class !== "healer" || ui.mode !== "unitSelected")
      return false;
    if (ally.side !== "player" || ally.hp >= ally.maxHp) return false;
    if (manhattan([selectedUnit.x, selectedUnit.y], [ally.x, ally.y]) !== 1) return false;
    const here: [number, number] = [selectedUnit.x, selectedUnit.y];
    const move: MoveBundle = {
      unitId: selectedUnit.id,
      path: [here],
      action: { type: "heal", targetId: ally.id },
    };
    dispatch({ type: "stageMove", move });
    return true;
  };

  const onTileClick = async (x: number, y: number) => {
    if (!id || !game || !isBoardInteractive) return;
    setBannerError(null);

    const unitOnTile = (game.units ?? []).find((u) => u.x === x && u.y === y);

    if (ui.mode === "idle") {
      if (unitOnTile) void onSelectUnit(unitOnTile);
      return;
    }

    if (ui.mode === "enemyInspect") {
      if (unitOnTile && unitOnTile.side === "player" && canSelectPlayerUnit(unitOnTile, ui)) {
        void onSelectUnit(unitOnTile);
      } else if (unitOnTile && unitOnTile.side === "enemy") {
        void onSelectUnit(unitOnTile);
      } else {
        dispatch({ type: "clearSelection" });
      }
      return;
    }

    if (ui.mode === "unitSelected" && selectedUnit) {
      if (unitOnTile) {
        if (unitOnTile.side === "enemy") {
          if (tryStageAttackFromCurrent(unitOnTile)) return;
          void onSelectUnit(unitOnTile); // inspect
          return;
        }
        if (unitOnTile.side === "player") {
          if (selectedUnit.class === "healer" && tryStageHealFromCurrent(unitOnTile)) return;
          if (canSelectPlayerUnit(unitOnTile, ui)) {
            void onSelectUnit(unitOnTile);
            return;
          }
        }
      }

      const isMove = effectiveMoveTiles.some((t) => t[0] === x && t[1] === y);
      if (isMove) {
        const origin: [number, number] = [selectedUnit.x, selectedUnit.y];
        const dest: [number, number] = [x, y];
        const path = computeDisplayPath(origin, dest, effectiveMoveTiles);
        if (path) {
          dispatch({ type: "pickMoveDestination", destination: dest, path });
          return;
        }
      }
      dispatch({ type: "clearSelection" });
      return;
    }

    if (ui.mode === "movePicked" && selectedUnit && ui.pickedDestination) {
      if (unitOnTile) {
        if (unitOnTile.side === "enemy") {
          const canAttack = actionableAttackTiles.some(
            (t) => t[0] === unitOnTile.x && t[1] === unitOnTile.y,
          );
          if (canAttack && ui.displayPath) {
            dispatch({
              type: "stageMove",
              move: {
                unitId: selectedUnit.id,
                path: ui.displayPath,
                action: { type: "attack", targetId: unitOnTile.id },
              },
            });
            return;
          }
          void onSelectUnit(unitOnTile);
          return;
        }
        if (unitOnTile.side === "player") {
          const canHeal = actionableHealTiles.some(
            (t) => t[0] === unitOnTile.x && t[1] === unitOnTile.y,
          );
          if (canHeal && ui.displayPath) {
            dispatch({
              type: "stageMove",
              move: {
                unitId: selectedUnit.id,
                path: ui.displayPath,
                action: { type: "heal", targetId: unitOnTile.id },
              },
            });
            return;
          }
          if (canSelectPlayerUnit(unitOnTile, ui)) {
            void onSelectUnit(unitOnTile);
            return;
          }
        }
      }
      // click elsewhere while move picked - keep pick? Esc/cancel handled separately; treat as clear/cancel to selected
      dispatch({ type: "cancelMovePick" });
      return;
    }

    if (ui.mode === "staged") {
      if (unitOnTile) void onSelectUnit(unitOnTile);
      else dispatch({ type: "clearSelection" });
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (ui.mode === "movePicked") dispatch({ type: "cancelMovePick" });
        else if (ui.mode === "unitSelected" || ui.mode === "enemyInspect")
          dispatch({ type: "clearSelection" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ui.mode]);

  const unactedCount = useMemo(() => {
    if (!game) return 0;
    return (game.units ?? []).filter(
      (u) => u.side === "player" && !u.acted && !stagedUnitIds.has(u.id),
    ).length;
  }, [game, stagedUnitIds]);

  const performEndTurn = async () => {
    if (!id || !game || game.status !== "player_turn") return;
    setSubmitting(true);
    setBannerError(null);
    setShowEndConfirm(false);
    try {
      dispatch({ type: "beginSubmit" });
      const movesRes = await submitMoves(id, ui.stagedMoves);
      const afterMoves = movesRes.game;
      setGame(afterMoves);
      if (afterMoves.status === "won" || afterMoves.status === "lost") {
        dispatch({ type: "submitSucceeded" });
        return;
      }
      setEndTurnBusy(true);
      const endRes = await endTurn(id);
      setGame(endRes.game);
      dispatch({ type: "submitSucceeded" });
    } catch (err) {
      if (err instanceof ApiError) {
        const idx = parseMoveErrorIndex(err.message);
        dispatch({ type: "submitFailed", error: err.message, errorMoveIndex: idx });
        setBannerError(err.message);
        // refresh authoritative state
        try {
          const fresh = await getGame(id);
          setGame(fresh.game);
        } catch {
          // ignore
        }
      } else {
        setBannerError("Failed to end turn");
      }
    } finally {
      setSubmitting(false);
      setEndTurnBusy(false);
    }
  };

  const onEndTurnClick = () => {
    if (!game || game.status !== "player_turn") return;
    if (unactedCount > 0) {
      setShowEndConfirm(true);
    } else {
      void performEndTurn();
    }
  };

  const onForfeit = async () => {
    if (!id) return;
    try {
      const res = await forfeitGame(id);
      setGame(res.game);
      setShowForfeitConfirm(false);
    } catch (err) {
      if (err instanceof ApiError) setBannerError(err.message);
    }
  };

  const onStageWait = () => {
    if (!selectedUnit || ui.mode !== "movePicked" || !ui.displayPath) return;
    dispatch({
      type: "stageMove",
      move: { unitId: selectedUnit.id, path: ui.displayPath, action: { type: "wait" } },
    });
  };

  const headerUnit = ui.mode === "enemyInspect" ? inspectUnit : selectedUnit;
  const personaLabel = game ? (meta?.personalities[game.difficulty]?.label ?? game.difficulty) : "";

  const showGenerating = game?.status === "generating_board";

  if (loading || !game || !meta) {
    return (
      <div className="page-shell">
        <TopMenu />
        <main className="page-content">
          <div className="spinner">Loading…</div>
        </main>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <TopMenu />
      <main className="page-content board-screen-content">
        <div className="board-layout">
          <div className="board-left">
            <div className={`phase-banner persona-${game.difficulty}`}>
              <span className="persona-badge-inline">{personaLabel}</span>
              <span>Turn {game.turnNumber}</span>
              <span className="phase-status">
                {game.status === "ai_turn"
                  ? "The darkness is thinking…"
                  : showGenerating
                    ? "The battlefield is being designed…"
                    : game.status === "player_turn"
                      ? "Your turn"
                      : game.status === "won"
                        ? "Victory"
                        : "Defeat"}
              </span>
            </div>

            <div
              className="board-grid"
              style={{
                gridTemplateColumns: `repeat(${boardSize}, 1fr)`,
                gridTemplateRows: `repeat(${boardSize}, 1fr)`,
              }}
            >
              {tiles.flatMap((row, y) =>
                row.map((tile, x) => {
                  const isMove =
                    ui.mode !== "idle" &&
                    ui.mode !== "staged" &&
                    effectiveMoveTiles.some((t) => t[0] === x && t[1] === y);
                  const isAttack = actionableAttackTiles.some((t) => t[0] === x && t[1] === y);
                  const isHeal = actionableHealTiles.some((t) => t[0] === x && t[1] === y);
                  const isInspect =
                    ui.mode === "enemyInspect" &&
                    effectiveMoveTiles.some((t) => t[0] === x && t[1] === y);
                  const isPicked =
                    ui.pickedDestination &&
                    ui.pickedDestination[0] === x &&
                    ui.pickedDestination[1] === y;
                  const classes = [
                    "board-tile",
                    tileClass(tile),
                    isMove ? "ov-move" : "",
                    isAttack ? "ov-attack" : "",
                    isHeal ? "ov-heal" : "",
                    isInspect ? "ov-inspect" : "",
                    isPicked ? "ov-selected-dest" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const u = (game.units ?? []).find((un) => un.x === x && un.y === y);
                  const stagedOriginHere = ui.stagedMoves.some(
                    (m) =>
                      m.path.length > 0 &&
                      m.path[0][0] === x &&
                      m.path[0][1] === y &&
                      !(m.path[m.path.length - 1][0] === x && m.path[m.path.length - 1][1] === y),
                  );
                  return (
                    <div
                      key={`${x}-${y}`}
                      data-testid={`tile-${x}-${y}`}
                      className={classes}
                      onClick={() => void onTileClick(x, y)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") void onTileClick(x, y);
                      }}
                    >
                      <img
                        className="terrain-sprite"
                        src={assetPath("terrain", tile)}
                        alt=""
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = "none";
                        }}
                      />
                      {stagedOriginHere ? <div className="staged-origin-marker" /> : null}
                      {u ? (
                        <div
                          data-testid={`unit-${u.id}`}
                          className={[
                            "unit-sprite-wrap",
                            `side-${u.side}`,
                            u.acted || stagedUnitIds.has(u.id) ? "acted" : "",
                            ui.selectedUnitId === u.id ? "selected-ring" : "",
                            ui.inspectUnitId === u.id ? "inspect-ring" : "",
                            ui.errorMoveIndex !== null &&
                            ui.stagedMoves[ui.errorMoveIndex]?.unitId === u.id
                              ? "error-ring"
                              : "",
                          ].join(" ")}
                          onClick={(e) => {
                            e.stopPropagation();
                            void onTileClick(x, y);
                          }}
                        >
                          <img
                            src={assetPath("sprite", themeId, u.class, u.side)}
                            alt={`${u.side} ${u.class}`}
                          />
                          {u.hp < u.maxHp ? (
                            <div className="hp-bar">
                              <div
                                className={`hp-fill ${u.hp / u.maxHp < 1 / 3 ? "hp-red" : u.hp / u.maxHp <= 2 / 3 ? "hp-amber" : "hp-green"}`}
                                style={{
                                  width: `${Math.max(0, Math.min(100, (u.hp / u.maxHp) * 100))}%`,
                                }}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                }),
              )}
            </div>

            {game.status === "won" || game.status === "lost" ? (
              <div className={`result-overlay ${game.status}`}>
                <div className="result-card card">
                  <h2>{game.status === "won" ? "Victory" : "Defeat"}</h2>
                  <button type="button" className="primary-btn" onClick={() => navigate("/play")}>
                    Back to battles
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="board-right">
            {bannerError || ui.submitError ? (
              <div className="error-banner">{bannerError || ui.submitError}</div>
            ) : null}

            <section className="action-panel card">
              {headerUnit ? (
                <>
                  <div className="action-header">
                    <img
                      className="action-portrait"
                      src={assetPath(
                        "portrait",
                        themeId,
                        headerUnit.class,
                        headerUnit.side === "enemy" ? "enemy" : "player",
                      )}
                      alt={headerUnit.class}
                    />
                    <div>
                      <div className="action-class-label">
                        {meta.classes[headerUnit.class]?.label ?? headerUnit.class}
                      </div>
                      <div className="action-mini-stats">
                        HP {headerUnit.hp}/{headerUnit.maxHp} · ATK{" "}
                        {meta.classes[headerUnit.class]?.atk ?? 0} · DEF{" "}
                        {meta.classes[headerUnit.class]?.def ?? 0}
                      </div>
                    </div>
                  </div>
                  {ui.mode === "enemyInspect" ? (
                    <p className="action-hint">Inspecting enemy unit.</p>
                  ) : ui.mode === "movePicked" ? (
                    <div className="action-buttons">
                      <button type="button" className="secondary-btn" onClick={onStageWait}>
                        Wait
                      </button>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => dispatch({ type: "cancelMovePick" })}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <p className="action-hint">Select a destination tile, or an action target.</p>
                  )}
                </>
              ) : (
                <p className="action-hint">Select one of your units to act.</p>
              )}
            </section>

            <section className="staged-bar card">
              <h3>Staged moves</h3>
              {ui.stagedMoves.length === 0 ? (
                <p className="muted">No moves staged.</p>
              ) : (
                <div className="staged-chips">
                  {ui.stagedMoves.map((m, i) => {
                    const u = unitsById.get(m.unitId);
                    const dest = m.path[m.path.length - 1];
                    const label = u ? unitLabel(u, meta) : m.unitId;
                    const actionText =
                      m.action.type === "attack"
                        ? `attack ${m.action.targetId}`
                        : m.action.type === "heal"
                          ? `heal ${m.action.targetId}`
                          : "wait";
                    return (
                      <button
                        key={`${m.unitId}-${i}`}
                        type="button"
                        data-testid={`staged-chip-${i}`}
                        className={`staged-chip ${ui.errorMoveIndex === i ? "error" : ""}`}
                        onClick={() => dispatch({ type: "unstageMove", index: i })}
                        disabled={!isBoardInteractive}
                        title="Click to unstage"
                      >
                        {label} → ({dest?.[0]},{dest?.[1]}) {actionText}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="unit-tray card" aria-label="Your units">
              {trayUnits.map((u) => {
                const staged = stagedUnitIds.has(u.id);
                return (
                  <button
                    key={u.id}
                    type="button"
                    className={`tray-chip ${u.acted || staged ? "acted" : ""} ${ui.selectedUnitId === u.id ? "selected" : ""}`}
                    onClick={() => void onSelectUnit(u)}
                    disabled={!isBoardInteractive || u.acted || staged}
                  >
                    <span className="tray-label">{unitLabel(u, meta)}</span>
                    <span className="tray-hp">
                      {u.hp}/{u.maxHp}
                    </span>
                  </button>
                );
              })}
            </section>

            <section className="turn-footer card">
              <button
                type="button"
                className="primary-btn"
                data-testid="end-turn"
                onClick={onEndTurnClick}
                disabled={!isBoardInteractive}
              >
                End turn
              </button>
              <button
                type="button"
                className="danger-btn"
                data-testid="forfeit"
                onClick={() => setShowForfeitConfirm(true)}
                disabled={game.status === "won" || game.status === "lost"}
              >
                Forfeit
              </button>
            </section>
          </div>
        </div>
      </main>

      <ConfirmModal
        open={showEndConfirm}
        title={`${unactedCount} unit(s) have not acted`}
        body={<p>End the turn anyway? The un-acted units simply skip this turn.</p>}
        cancelLabel="Keep acting"
        confirmLabel="End turn"
        onCancel={() => setShowEndConfirm(false)}
        onConfirm={() => void performEndTurn()}
      />

      <ConfirmModal
        open={showForfeitConfirm}
        title="Forfeit battle?"
        body={<p>This battle will be counted as a loss.</p>}
        cancelLabel="Cancel"
        confirmLabel="Forfeit"
        danger
        onCancel={() => setShowForfeitConfirm(false)}
        onConfirm={() => void onForfeit()}
      />
    </div>
  );
}
