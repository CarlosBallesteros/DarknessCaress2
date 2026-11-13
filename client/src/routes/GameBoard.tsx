import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { TopMenu } from "../components/TopMenu";
import { endTurn, forfeitGame, getGame, previewUnit, submitMoves } from "../api/games";
import { getMeta } from "../api/meta";
import { usePolling } from "../hooks/usePolling";
import { boardReducer, initialBoardState, type StagedMove } from "../state/stagedMoves";
import type { GameState, Meta, PreviewResponse, Unit } from "../types";
import { ApiError } from "../types";
import { assetPath } from "../utils/assetPath";
import {
  computeLocalMoveTiles,
  filterAttackTilesFromDestination,
  shortestPath,
} from "../utils/path";
import "../styles/GameBoard.css";

type Point = [number, number];

const DISPLAY_ORDER = ["sword", "axe", "spear", "archer", "mage", "healer"];

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function hpClass(hp: number, maxHp: number): string {
  if (hp >= maxHp) return "hp-full";
  const f = hp / maxHp;
  if (f > 2 / 3) return "hp-green";
  if (f >= 1 / 3) return "hp-amber";
  return "hp-red";
}

function statusText(game: GameState, personaLabel: string): string {
  if (game.status === "generating_board") return "The battlefield is being designed…";
  if (game.status === "ai_turn") return "The darkness is thinking…";
  if (game.status === "won") return "Victory";
  if (game.status === "lost") return "Defeat";
  return `Your turn — ${personaLabel}`;
}

function deriveGhostUnits(units: Unit[], staged: StagedMove[]): Unit[] {
  const byId = new Map(units.map((u) => [u.id, { ...u }]));
  for (const s of staged) {
    const u = byId.get(s.unitId);
    const dest = s.path[s.path.length - 1];
    if (u && dest) {
      u.x = dest[0];
      u.y = dest[1];
    }
  }
  return Array.from(byId.values());
}

export function GameBoard() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [game, setGame] = useState<GameState | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [boardState, dispatch] = useReducer(boardReducer, initialBoardState);
  const [submitting, setSubmitting] = useState(false);
  const [inspectedPreview, setInspectedPreview] = useState<PreviewResponse | null>(null);
  const [overlay, setOverlay] = useState<"none" | "victory" | "defeat">("none");
  const [animatingAi, setAnimatingAi] = useState(false);
  const [showForfeitConfirm, setShowForfeitConfirm] = useState(false);
  const [forfeiting, setForfeiting] = useState(false);
  const [endTurnConfirmCount, setEndTurnConfirmCount] = useState<number | null>(null);
  const animatingRef = useRef(false);
  const prevStatusRef = useRef<GameState["status"] | null>(null);
  const lastAnimatedTurnRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [gRes, mRes] = await Promise.all([
        getGame(id),
        meta ? Promise.resolve(meta) : getMeta(),
      ]);
      setGame(gRes.game);
      if (!meta) setMeta(mRes as Meta);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to load game");
    } finally {
      setLoading(false);
    }
  }, [id, meta]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!game) return;
    if (game.status === "won") setOverlay("victory");
    else if (game.status === "lost") setOverlay("defeat");
    else setOverlay("none");
  }, [game]);

  // AI action animation when status flips to player_turn with lastAiActions
  useEffect(() => {
    if (!game) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = game.status;
    if (
      prev === "ai_turn" &&
      game.status === "player_turn" &&
      game.lastAiActions &&
      game.lastAiActions.length > 0 &&
      lastAnimatedTurnRef.current !== game.turnNumber
    ) {
      lastAnimatedTurnRef.current = game.turnNumber;
      animatingRef.current = true;
      setAnimatingAi(true);
      const total = game.lastAiActions.length * 400;
      const t = window.setTimeout(() => {
        animatingRef.current = false;
        setAnimatingAi(false);
      }, total);
      return () => window.clearTimeout(t);
    }
    return;
  }, [game]);

  const pollingActive =
    !!game &&
    (game.status === "ai_turn" || game.status === "generating_board") &&
    !animatingAi &&
    !submitting;
  usePolling(load, pollingActive, 3000);

  const boardSize = meta?.boardSize ?? 8;
  const themeId = game && meta ? (meta.themes[0]?.id ?? "warriors-europe") : "warriors-europe";
  const personaLabel =
    game && meta
      ? (meta.personalities[game.difficulty]?.label ?? game.difficulty)
      : (game?.difficulty ?? "");

  const staged = boardState.staged;
  const ghostUnits = useMemo(
    () => (game ? deriveGhostUnits(game.units, staged) : []),
    [game, staged],
  );
  const stagedUnitIds = new Set(staged.map((s) => s.unitId));
  const stagedOriginKeys = new Set<string>();
  if (game) {
    for (const s of staged) {
      const u = game.units.find((x) => x.id === s.unitId);
      if (u) stagedOriginKeys.add(key(u.x, u.y));
    }
  }

  const effectiveMoveTiles = useMemo((): Point[] => {
    if (!game || !meta) return [];
    const mode = boardState.mode;
    if (mode.kind === "unitSelected") {
      const unit = game.units.find((u) => u.id === mode.unitId);
      if (!unit) return [];
      const cls = meta.classes[unit.class];
      const mov = cls?.mov ?? 0;
      const local = computeLocalMoveTiles(
        game.board.tiles,
        boardSize,
        game.units,
        unit.id,
        mov,
        staged,
      );
      if (staged.length > 0) return local;
      return mode.preview.moveTiles as Point[];
    }
    if (mode.kind === "movePicked") return [];
    return [];
  }, [boardState.mode, game, meta, staged, boardSize]);

  const selectableUnit = (unit: Unit): boolean => {
    if (game?.status !== "player_turn") return false;
    if (unit.side !== "player") return false;
    if (unit.acted) return false;
    if (stagedUnitIds.has(unit.id)) return false;
    return true;
  };

  const onSelectUnit = async (unit: Unit) => {
    if (!game || !id) return;
    if (game.status !== "player_turn") return;
    if (animatingRef.current) return;

    // enemy inspect
    if (unit.side === "enemy") {
      const mode = boardState.mode;
      if (mode.kind === "unitSelected") {
        const own = game.units.find((u) => u.id === mode.unitId);
        if (own && meta && staged.length === 0) {
          const cls = meta.classes[own.class];
          const range = cls?.range ?? [];
          const d = Math.abs(unit.x - own.x) + Math.abs(unit.y - own.y);
          const inAttack = (mode.preview.attackTiles as Point[]).some(
            ([x, y]) => x === unit.x && y === unit.y,
          );
          if (inAttack && range.includes(d)) {
            const move: StagedMove = {
              unitId: own.id,
              path: [[own.x, own.y]],
              action: { type: "attack", targetId: unit.id },
            };
            dispatch({ type: "stageMove", move });
            return;
          }
        }
      }
      if (mode.kind === "movePicked") {
        const own = game.units.find((u) => u.id === mode.unitId);
        if (own) {
          const cls = meta?.classes[own.class];
          const range = cls?.range ?? [];
          const filteredAttacks = filterAttackTilesFromDestination(
            mode.destination,
            mode.preview.attackTiles as Point[],
            range,
          );
          if (filteredAttacks.some(([x, y]) => x === unit.x && y === unit.y)) {
            const move: StagedMove = {
              unitId: own.id,
              path: mode.path,
              action: { type: "attack", targetId: unit.id },
            };
            dispatch({ type: "stageMove", move });
            return;
          }
        }
      }
      try {
        const preview = await previewUnit(id, unit.id);
        dispatch({ type: "inspectEnemy", unitId: unit.id, preview });
        setInspectedPreview(preview);
      } catch (e) {
        setBannerError(e instanceof ApiError ? e.message : "Preview failed");
      }
      return;
    }

    // own unit
    if (!selectableUnit(unit)) return;
    try {
      const preview = await previewUnit(id, unit.id);
      dispatch({ type: "selectUnit", unitId: unit.id, preview });
      setInspectedPreview(null);
    } catch (e) {
      setBannerError(e instanceof ApiError ? e.message : "Preview failed");
    }
  };

  const onTileClick = async (x: number, y: number) => {
    if (!game || !id || !meta) return;
    if (game.status !== "player_turn") return;
    if (animatingRef.current) return;
    const mode = boardState.mode;

    if (mode.kind === "unitSelected") {
      const moveTiles = effectiveMoveTiles;
      const isMoveTile = moveTiles.some(([mx, my]) => mx === x && my === y);
      const clickedUnit = ghostUnits.find((u) => u.x === x && u.y === y);
      if (clickedUnit && clickedUnit.side === "enemy") {
        // enemy clicks handled in onSelectUnit generally, but tile click on enemy sprite area can bubble
        await onSelectUnit(clickedUnit);
        return;
      }
      if (isMoveTile) {
        const own = game.units.find((u) => u.id === mode.unitId);
        if (!own) return;
        const start: Point =
          staged.length > 0
            ? (() => {
                // recompute from ghost position
                const g = ghostUnits.find((u) => u.id === own.id);
                return g ? ([g.x, g.y] as Point) : ([own.x, own.y] as Point);
              })()
            : [own.x, own.y];
        const path = shortestPath(start, [x, y], moveTiles) ?? [start, [x, y]];
        dispatch({ type: "pickDestination", destination: [x, y], path });
        return;
      }
      if (!clickedUnit) {
        dispatch({ type: "clearMode" });
      }
      return;
    }

    if (mode.kind === "movePicked") {
      const own = game.units.find((u) => u.id === mode.unitId);
      if (!own) return;
      const cls = meta.classes[own.class];
      const range = cls?.range ?? [];
      const clickedUnit = game.units.find((u) => u.x === x && u.y === y && u.hp > 0);
      const ghostClicked = ghostUnits.find((u) => u.x === x && u.y === y && u.hp > 0);

      // heal target: own wounded unit in green overlay (adjacent to destination reachable final tile)
      if (cls && cls.healAmount !== undefined) {
        const healTargets = (mode.preview.healTiles as Point[]).filter(([hx, hy]) => {
          // filter to those adjacent to picked destination (client-side filter over preview union)
          return Math.abs(hx - mode.destination[0]) + Math.abs(hy - mode.destination[1]) === 1;
        });
        const isHealTile = healTargets.some(([hx, hy]) => hx === x && hy === y);
        const target = clickedUnit ?? ghostClicked;
        if (isHealTile && target && target.side === "player" && target.hp < target.maxHp) {
          dispatch({
            type: "stageMove",
            move: {
              unitId: own.id,
              path: mode.path,
              action: { type: "heal", targetId: target.id },
            },
          });
          return;
        }
      }

      // attack target
      const filteredAttacks = filterAttackTilesFromDestination(
        mode.destination,
        mode.preview.attackTiles as Point[],
        range,
      );
      const isAttackTile = filteredAttacks.some(([ax, ay]) => ax === x && ay === y);
      const targetEnemy = clickedUnit ?? ghostClicked;
      if (isAttackTile && targetEnemy && targetEnemy.side === "enemy") {
        dispatch({
          type: "stageMove",
          move: {
            unitId: own.id,
            path: mode.path,
            action: { type: "attack", targetId: targetEnemy.id },
          },
        });
        return;
      }

      // clicking another own selectable unit -> reselect
      if (clickedUnit && clickedUnit.side === "player" && selectableUnit(clickedUnit)) {
        await onSelectUnit(clickedUnit);
        return;
      }
      // clicking enemy not actionable -> inspect
      if (clickedUnit && clickedUnit.side === "enemy") {
        await onSelectUnit(clickedUnit);
        return;
      }
      // empty or other -> back/idle
      dispatch({ type: "backToSelected" });
      return;
    }

    if (mode.kind === "enemyInspect" || mode.kind === "idle") {
      const clickedUnit = game.units.find((u) => u.x === x && u.y === y && u.hp > 0);
      if (clickedUnit) {
        await onSelectUnit(clickedUnit);
      } else {
        dispatch({ type: "clearMode" });
      }
    }
  };

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        if (boardState.mode.kind === "movePicked") dispatch({ type: "backToSelected" });
        else dispatch({ type: "clearMode" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [boardState.mode.kind]);

  const waitInPlace = () => {
    const mode = boardState.mode;
    if (mode.kind !== "movePicked" || !game) return;
    dispatch({
      type: "stageMove",
      move: { unitId: mode.unitId, path: mode.path, action: { type: "wait" } },
    });
  };

  const performEndTurn = async () => {
    if (!game || !id) return;
    setSubmitting(true);
    setBannerError(null);
    try {
      const movesRes = await submitMoves(id, {
        moves: staged.map((s) => ({ unitId: s.unitId, path: s.path, action: s.action })),
      });
      const afterMoves = movesRes.game;
      setGame(afterMoves);
      if (afterMoves.status === "won") {
        setOverlay("victory");
        dispatch({ type: "reset" });
        return;
      }
      if (afterMoves.status === "lost") {
        setOverlay("defeat");
        dispatch({ type: "reset" });
        return;
      }
      const endRes = await endTurn(id);
      setGame(endRes.game);
      dispatch({ type: "reset" });
    } catch (e) {
      if (e instanceof ApiError) {
        setBannerError(e.message);
        const m = /^move (\d+):/i.exec(e.message);
        if (m) {
          const idx = Number(m[1]) - 1;
          dispatch({
            type: "setError",
            index: idx,
            message: e.message,
            flashUntil: Date.now() + 1200,
          });
        }
      } else {
        setBannerError("Failed to submit turn");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const requestEndTurn = () => {
    if (!game || !id) return;
    const unacted = game.units.filter(
      (u) => u.side === "player" && !u.acted && !stagedUnitIds.has(u.id),
    );
    if (unacted.length > 0) {
      setEndTurnConfirmCount(unacted.length);
      return;
    }
    void performEndTurn();
  };

  const confirmEndTurn = async () => {
    setEndTurnConfirmCount(null);
    await performEndTurn();
  };

  const requestForfeit = () => {
    setShowForfeitConfirm(true);
  };

  const confirmForfeit = async () => {
    if (!id) return;
    setForfeiting(true);
    setBannerError(null);
    try {
      const res = await forfeitGame(id);
      setGame(res.game);
      setOverlay("defeat");
      setShowForfeitConfirm(false);
    } catch (e) {
      setBannerError(e instanceof ApiError ? e.message : "Failed to forfeit");
    } finally {
      setForfeiting(false);
    }
  };

  const onUnstage = (index: number) => {
    dispatch({ type: "unstage", index });
  };

  if (!id) return null;
  if (loading && !game) {
    return (
      <main className="page-with-menu">
        <TopMenu />
        <div className="spinner">Loading…</div>
      </main>
    );
  }
  if (error && !game) {
    return (
      <main className="page-with-menu">
        <TopMenu />
        <div className="error-banner">{error}</div>
      </main>
    );
  }
  if (!game) return null;

  const tiles = game.board.tiles;
  const unitsByPos = new Map<string, Unit>();
  for (const u of ghostUnits) {
    if (u.hp > 0) unitsByPos.set(key(u.x, u.y), u);
  }
  const selectedId =
    boardState.mode.kind === "unitSelected" || boardState.mode.kind === "movePicked"
      ? boardState.mode.unitId
      : null;
  const inspectedId = boardState.mode.kind === "enemyInspect" ? boardState.mode.unitId : null;

  const mode = boardState.mode;
  const moveOverlay = mode.kind === "unitSelected" ? effectiveMoveTiles : [];
  let attackOverlay: Point[] = [];
  let healOverlay: Point[] = [];
  let inspectOverlay: Point[] = [];
  if (mode.kind === "movePicked" && meta) {
    const own = game.units.find((u) => u.id === mode.unitId);
    const range = own ? (meta.classes[own.class]?.range ?? []) : [];
    attackOverlay = filterAttackTilesFromDestination(
      mode.destination,
      mode.preview.attackTiles as Point[],
      range,
    );
    if (own && meta.classes[own.class]?.healAmount !== undefined) {
      healOverlay = (mode.preview.healTiles as Point[]).filter(
        ([hx, hy]) => Math.abs(hx - mode.destination[0]) + Math.abs(hy - mode.destination[1]) === 1,
      );
    }
  }
  if (mode.kind === "unitSelected") {
    // show union hints? spec: "overlay draws" and later filters; keep simple: show attack/heal from current reachable union subtly not required explicitly
    // but action-from-current-tile uses preview.attackTiles; show them for clarity when no dest picked
    attackOverlay = (mode.preview.attackTiles as Point[]).filter(([ax, ay]) => {
      const own = game.units.find((u) => u.id === mode.unitId);
      if (!own) return false;
      // reachable from current tile if distance from own position in range? preview is union from any reachable final tile;
      // "attack from where I stand" allowed when target reachable from unit's CURRENT tile
      const cls = meta?.classes[own.class];
      if (!cls) return false;
      const d = Math.abs(ax - own.x) + Math.abs(ay - own.y);
      return cls.range.includes(d);
    });
  }
  if (mode.kind === "enemyInspect") {
    inspectOverlay = (mode.preview.moveTiles ?? []) as Point[];
  }

  const moveSet = new Set(moveOverlay.map(([x, y]) => key(x, y)));
  const attackSet = new Set(attackOverlay.map(([x, y]) => key(x, y)));
  const healSet = new Set(healOverlay.map(([x, y]) => key(x, y)));
  const inspectSet = new Set(inspectOverlay.map(([x, y]) => key(x, y)));

  const trayUnits = game.units
    .filter((u) => u.side === "player" && u.hp > 0)
    .sort((a, b) => {
      const ia = DISPLAY_ORDER.indexOf(a.class);
      const ib = DISPLAY_ORDER.indexOf(b.class);
      if (ia !== ib) return ia - ib;
      return a.id.localeCompare(b.id);
    });

  const selectedUnit = selectedId ? (game.units.find((u) => u.id === selectedId) ?? null) : null;
  const inspectedUnit = inspectedId ? (game.units.find((u) => u.id === inspectedId) ?? null) : null;
  const panelUnit = mode.kind === "enemyInspect" ? inspectedUnit : selectedUnit;
  const panelPreview =
    mode.kind === "enemyInspect"
      ? inspectedPreview
      : mode.kind === "unitSelected" || mode.kind === "movePicked"
        ? mode.preview
        : null;

  const errorIdx = boardState.errorMoveIndex;
  const flash = boardState.errorFlashUntil && Date.now() < boardState.errorFlashUntil;

  return (
    <main className="page-with-menu board-screen">
      <TopMenu />
      <div className={`phase-banner persona-${game.difficulty} status-${game.status}`}>
        <span className={`persona-badge persona-${game.difficulty}`}>{personaLabel}</span>
        <span>Turn {game.turnNumber}</span>
        <span
          className={game.status === "ai_turn" || game.status === "generating_board" ? "pulse" : ""}
        >
          {statusText(game, personaLabel)}
        </span>
      </div>
      {bannerError || boardState.errorMessage ? (
        <div className="error-banner">{boardState.errorMessage ?? bannerError}</div>
      ) : null}

      <div className="board-layout">
        <div className="board-wrap">
          <div
            className="board-grid"
            style={{
              gridTemplateColumns: `repeat(${boardSize}, var(--tile-size))`,
              gridTemplateRows: `repeat(${boardSize}, var(--tile-size))`,
              ["--tile-size" as string]: `clamp(28px, calc((min(100vw, 720px) - 2rem) / ${boardSize}), 44px)`,
            }}
          >
            {tiles.map((row, y) =>
              row.map((tile, x) => {
                const posKey = key(x, y);
                const u = unitsByPos.get(posKey);
                const isMove = moveSet.has(posKey);
                const isAttack = attackSet.has(posKey);
                const isHeal = healSet.has(posKey);
                const isInspect = inspectSet.has(posKey);
                const isSelected = !!u && u.id === selectedId;
                const isInspected = !!u && u.id === inspectedId;
                const isStagedOrigin =
                  stagedOriginKeys.has(posKey) &&
                  (!u ||
                    u.id !==
                      staged.find((s) => {
                        const ou = game.units.find((uu) => uu.id === s.unitId);
                        return ou && ou.x === x && ou.y === y;
                      })?.unitId);
                return (
                  <div
                    key={`${x}-${y}`}
                    className={`tile tile-${tile} ${isMove ? "ov-move" : ""} ${isAttack ? "ov-attack" : ""} ${isHeal ? "ov-heal" : ""} ${isInspect ? "ov-inspect" : ""} ${isSelected ? "selected" : ""} ${isInspected ? "inspected" : ""} ${isStagedOrigin ? "staged-origin" : ""}`}
                    data-testid={`tile-${x}-${y}`}
                    onClick={() => void onTileClick(x, y)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") void onTileClick(x, y);
                    }}
                  >
                    <img
                      className="terrain-img"
                      src={assetPath("terrain", tile)}
                      alt=""
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                    />
                    {u ? (
                      <div
                        className={`unit-sprite ${u.side} ${u.acted || stagedUnitIds.has(u.id) ? "acted" : ""} ${flash && errorIdx !== null && staged[errorIdx]?.unitId === u.id ? "error-flash" : ""}`}
                        data-testid={`unit-${u.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void onSelectUnit(u);
                        }}
                        title={u.id}
                      >
                        <img
                          src={assetPath("sprite", themeId, u.class, u.side)}
                          alt={`${u.side} ${u.class}`}
                          onError={(e) => {
                            const el = e.currentTarget as HTMLImageElement;
                            el.style.display = "none";
                            console.warn("Missing sprite", el.src);
                          }}
                        />
                        {u.hp < u.maxHp ? (
                          <div className={`hp-bar ${hpClass(u.hp, u.maxHp)}`}>
                            <div
                              className="hp-fill"
                              style={{ width: `${Math.max(0, (u.hp / u.maxHp) * 100)}%` }}
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
        </div>

        <aside className="side-panel">
          <div className="action-panel">
            {panelUnit && meta ? (
              <>
                <div className="panel-header">
                  <img
                    className="panel-portrait"
                    src={assetPath("portrait", themeId, panelUnit.class, panelUnit.side)}
                    alt={`${panelUnit.class} portrait`}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                    }}
                  />
                  <div>
                    <div className="panel-class">
                      {meta.classes[panelUnit.class]?.label ?? panelUnit.class}
                    </div>
                    <div className="panel-stats">
                      HP {panelUnit.hp}/{panelUnit.maxHp} · ATK{" "}
                      {meta.classes[panelUnit.class]?.atk ?? 0} · DEF{" "}
                      {meta.classes[panelUnit.class]?.def ?? 0}
                    </div>
                  </div>
                </div>
                {mode.kind === "enemyInspect" ? (
                  <p className="panel-hint">Inspecting enemy unit.</p>
                ) : null}
                {mode.kind === "unitSelected" ? (
                  <div className="panel-actions">
                    <p className="panel-hint">Select a destination tile or a valid target.</p>
                    {panelUnit &&
                    (panelPreview?.attackTiles ?? []).some(([ax, ay]) => {
                      const cls = meta.classes[panelUnit.class];
                      if (!cls) return false;
                      return cls.range.includes(
                        Math.abs(ax - panelUnit.x) + Math.abs(ay - panelUnit.y),
                      );
                    }) ? (
                      <p className="panel-hint">
                        You can attack from current position by clicking a highlighted enemy.
                      </p>
                    ) : null}
                    <button type="button" onClick={() => dispatch({ type: "clearMode" })}>
                      Cancel
                    </button>
                  </div>
                ) : null}
                {mode.kind === "movePicked" ? (
                  <div className="panel-actions">
                    <p className="panel-hint">
                      Choose an action from the destination: attack, heal, or wait.
                    </p>
                    <button type="button" onClick={waitInPlace}>
                      Wait in place
                    </button>
                    <button type="button" onClick={() => dispatch({ type: "backToSelected" })}>
                      Back
                    </button>
                    <button type="button" onClick={() => dispatch({ type: "clearMode" })}>
                      Cancel staged
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <p className="panel-hint">Select one of your units to begin.</p>
            )}
          </div>

          <div className="staged-bar">
            <h3>Staged moves</h3>
            <div className="staged-chips">
              {staged.map((s, i) => (
                <button
                  key={`${s.unitId}-${i}`}
                  type="button"
                  className={`staged-chip ${errorIdx === i ? "chip-error" : ""}`}
                  data-testid={`staged-chip-${i}`}
                  onClick={() => onUnstage(i)}
                  title="Click to unstage"
                >
                  {s.unitId} → ({s.path[s.path.length - 1]?.[0]},{s.path[s.path.length - 1]?.[1]}){" "}
                  {s.action.type}
                  {"targetId" in s.action ? ` ${s.action.targetId}` : ""}
                </button>
              ))}
            </div>
          </div>
        </aside>
      </div>

      <div className="unit-tray">
        {trayUnits.map((u) => (
          <button
            key={u.id}
            type="button"
            className={`tray-unit ${u.id === selectedId ? "selected" : ""} ${u.acted || stagedUnitIds.has(u.id) ? "acted" : ""}`}
            onClick={() => void onSelectUnit(u)}
          >
            <span className="tray-label">{meta?.classes[u.class]?.label ?? u.class}</span>
            <span className="tray-hp">
              {u.hp}/{u.maxHp}
            </span>
          </button>
        ))}
      </div>

      <footer className="turn-footer">
        <button
          type="button"
          className="primary"
          data-testid="end-turn"
          onClick={requestEndTurn}
          disabled={game.status !== "player_turn" || submitting || animatingAi}
        >
          End turn
        </button>
        <button
          type="button"
          data-testid="forfeit"
          onClick={requestForfeit}
          disabled={submitting || forfeiting}
        >
          Forfeit
        </button>
      </footer>

      {overlay === "victory" || overlay === "defeat" ? (
        <div className="result-overlay">
          <div className="result-card">
            <h2>{overlay === "victory" ? "Victory" : "Defeat"}</h2>
            <button type="button" onClick={() => navigate("/play")}>
              Back to games
            </button>
          </div>
        </div>
      ) : null}
      {showForfeitConfirm ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !forfeiting) {
              setShowForfeitConfirm(false);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !forfeiting) {
              setShowForfeitConfirm(false);
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
                onClick={() => setShowForfeitConfirm(false)}
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
      {endTurnConfirmCount !== null ? (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget && !submitting) {
              setEndTurnConfirmCount(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && !submitting) {
              setEndTurnConfirmCount(null);
            }
          }}
          tabIndex={-1}
        >
          <div className="modal">
            <h2>{`${endTurnConfirmCount} unit(s) have not acted`}</h2>
            <p>End the turn anyway? The un-acted units simply skip this turn.</p>
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setEndTurnConfirmCount(null)}
                disabled={submitting}
              >
                Keep acting
              </button>
              <button
                type="button"
                className="primary"
                data-testid="end-turn-confirm"
                onClick={() => void confirmEndTurn()}
                disabled={submitting}
              >
                End turn
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
