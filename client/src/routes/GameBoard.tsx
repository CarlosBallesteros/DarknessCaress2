import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { Link, useParams } from "react-router-dom";
import { endTurn, forfeit, getGame, getPreview, postMoves } from "../api/games";
import { getMeta } from "../api/meta";
import { ApiError } from "../api/request";
import { ActionPanel } from "../components/ActionPanel";
import { Board } from "../components/Board";
import type { BoardOverlays, BoardPopup } from "../components/Board";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PhaseBanner } from "../components/PhaseBanner";
import { StagedMovesBar } from "../components/StagedMovesBar";
import { TurnFooter } from "../components/TurnFooter";
import { UnitTray } from "../components/UnitTray";
import { useUser } from "../components/UserContext";
import { usePolling } from "../hooks/usePolling";
import { manhattan, shortestPath } from "../state/boardPath";
import { initialBoardUi, stagedMovesReducer } from "../state/stagedMoves";
import type {
  GameStatus,
  GameState,
  MetaResponse,
  MoveAction,
  Unit,
  XY,
} from "../types/api";
import "../styles/board.css";

interface AiAnimation {
  // authoritative post-AI-turn state, applied once the animation settles
  finalGame: GameState;
  // working copy mutated as the animation steps through the actions
  units: Unit[];
  popups: BoardPopup[];
}

const wait = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

export function GameBoard(): React.JSX.Element {
  const { id = "" } = useParams();
  const { user } = useUser();
  const [game, setGame] = useState<GameState | null>(null);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ui, uiDispatch] = useReducer(stagedMovesReducer, initialBoardUi);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dialog, setDialog] = useState<"end" | "forfeit" | null>(null);
  const [anim, setAnim] = useState<AiAnimation | null>(null);
  const prevStatusRef = useRef<GameStatus | null>(null);

  useEffect(() => {
    void getMeta()
      .then(setMeta)
      .catch(() => undefined);
  }, []);

  const refresh = useCallback((): Promise<void> => {
    return getGame(id)
      .then((fresh) => {
        const prev = prevStatusRef.current;
        prevStatusRef.current = fresh.status;
        if (
          prev === "ai_turn" &&
          fresh.status === "player_turn" &&
          (fresh.lastAiActions?.length ?? 0) > 0
        ) {
          // Animate only the poll response that flipped the status (05) —
          // stale lastAiActions are never re-animated.
          setAnim({
            finalGame: fresh,
            units: fresh.units.map((u) => ({ ...u })),
            popups: [],
          });
          return;
        }
        setGame(fresh);
      })
      .catch((err: unknown) => {
        if (!(err instanceof ApiError && err.status === 401)) {
          setLoadError(
            err instanceof ApiError
              ? err.message
              : "Could not load the battle.",
          );
        }
      });
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 3 s GET /play/:id while ai_turn (05) — paused while the flip animation plays.
  usePolling(
    () => {
      void refresh();
    },
    game?.status === "ai_turn" && anim === null,
  );

  // AI-turn animation: step through the actions, moving sprites along their
  // path (CSS transform transitions), flashing attacks/heals with damage
  // popups; then settle to the authoritative final state (05).
  useEffect(() => {
    if (anim === null) {
      return;
    }
    let cancelled = false;
    const units = anim.units;
    const patch = (popups: BoardPopup[]): void => {
      if (!cancelled) {
        setAnim((a) => (a === null ? a : { ...a, units: [...units], popups }));
      }
    };
    void (async () => {
      for (const [index, action] of (
        anim.finalGame.lastAiActions ?? []
      ).entries()) {
        const actor = units.find((u) => u.id === action.unitId);
        for (let i = 1; i < action.path.length; i++) {
          if (cancelled) return;
          const step = action.path[i] as XY;
          if (actor !== undefined) {
            actor.x = step[0];
            actor.y = step[1];
            patch([]);
          }
          await wait(120);
        }
        if (cancelled) return;
        const outcome = action.outcome;
        if (outcome === null || actor === undefined) {
          patch([]);
          await wait(200);
          continue;
        }
        const popups: BoardPopup[] = [];
        const target = units.find((u) => u.id === outcome.targetId);
        if (target !== undefined) {
          target.hp = outcome.targetHp;
          popups.push({
            key: `${index}-target`,
            x: target.x,
            y: target.y,
            text: `${action.action.type === "heal" ? "+" : "−"}${outcome.damage}`,
            kind: action.action.type === "heal" ? "heal" : "damage",
          });
        }
        if (outcome.counter !== null) {
          actor.hp = outcome.counter.attackerHp; // attacker's hp AFTER the counter (06)
          popups.push({
            key: `${index}-counter`,
            x: actor.x,
            y: actor.y,
            text: `−${outcome.counter.damage}`,
            kind: "counter",
          });
        }
        patch(popups);
        await wait(400);
        if (cancelled) return;
        for (let i = units.length - 1; i >= 0; i--) {
          const u = units[i] as Unit;
          if (u.hp <= 0) units.splice(i, 1);
        }
        patch([]);
      }
      if (!cancelled) {
        setGame(anim.finalGame);
        setAnim(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [anim]);

  const interactive =
    game !== null &&
    game.status === "player_turn" &&
    anim === null &&
    !submitting;

  // A local const so the discriminated union narrows inside closures below.
  const selection = ui.selection;
  const selectedUnit =
    selection.kind === "none" || game === null
      ? null
      : (game.units.find((u) => u.id === selection.unitId) ?? null);

  // Overlays per phase (05): unitSelected → the preview's union; movePicked →
  // the union FILTERED by pure arithmetic against the picked destination (the
  // class's range list lives in /api/meta — no server call, no duplicated
  // pathfinding).
  const overlays: BoardOverlays = useMemo(() => {
    if (
      game === null ||
      meta === null ||
      selection.kind === "none" ||
      anim !== null
    ) {
      return {
        moveTiles: [],
        attackTiles: [],
        healTiles: [],
        pathTiles: [],
        selectedUnitId: null,
      };
    }
    const sel = selection;
    if (sel.kind === "unit") {
      return {
        moveTiles: sel.preview.moveTiles,
        attackTiles: sel.preview.attackTiles,
        healTiles: sel.preview.healTiles,
        pathTiles: [],
        selectedUnitId: sel.unitId,
      };
    }
    const classMeta = meta.classes[selectedUnit?.class ?? "sword"];
    return {
      moveTiles: sel.preview.moveTiles,
      attackTiles: sel.preview.attackTiles.filter((t) =>
        classMeta.range.includes(manhattan(sel.destination, t)),
      ),
      healTiles: sel.preview.healTiles.filter(
        (t) => manhattan(sel.destination, t) === 1,
      ),
      pathTiles: sel.path,
      selectedUnitId: sel.unitId,
    };
  }, [game, meta, selection, anim, selectedUnit?.class]);

  const stagedIds = useMemo(
    () => new Set(ui.staged.map((m) => m.unitId)),
    [ui.staged],
  );

  const unitsAt = (tiles: XY[], side: "player" | "enemy"): Unit[] => {
    if (game === null) return [];
    return tiles
      .map(([x, y]) =>
        game.units.find((u) => u.x === x && u.y === y && u.side === side),
      )
      .filter((u): u is Unit => u !== undefined);
  };

  const onTileClick = (x: number, y: number): void => {
    if (!interactive || selectedUnit === null || selection.kind === "none") {
      return;
    }
    const sel = selection;
    const isMoveTile = sel.preview.moveTiles.some(
      (t) => t[0] === x && t[1] === y,
    );
    if (!isMoveTile) {
      uiDispatch({ type: sel.kind === "move" ? "back" : "deselect" });
      return;
    }
    // Ally-occupied tiles are pass-through for routing (00) but never in
    // moveTiles — the BFS may cross them, never land on them.
    const passThrough = game.units
      .filter((u) => u.side === "player" && u.id !== sel.unitId)
      .map((u): XY => [u.x, u.y]);
    const path = shortestPath(
      sel.preview.moveTiles,
      passThrough,
      [selectedUnit.x, selectedUnit.y],
      [x, y],
    );
    if (path === null) {
      return;
    }
    uiDispatch({ type: "pickMove", destination: [x, y], path });
  };

  const onUnitClick = (unitId: string): void => {
    if (!interactive || game === null) {
      return;
    }
    const unit = game.units.find((u) => u.id === unitId);
    if (unit === undefined) {
      return;
    }
    const sel = selection;
    if (unit.side === "player") {
      if (sel.kind === "move" && unit.id !== sel.unitId) {
        // click own wounded unit in the green overlay (healer) → stage heal
        const inHeal = overlays.healTiles.some(
          (t) => t[0] === unit.x && t[1] === unit.y,
        );
        if (inHeal) {
          uiDispatch({
            type: "stage",
            action: { type: "heal", targetId: unit.id },
          });
          return;
        }
      }
      if (stagedIds.has(unit.id)) {
        return; // a staged unit cannot act again this round
      }
      if (unit.acted) {
        uiDispatch({ type: "deselect" }); // dimmed area
        return;
      }
      if (sel.kind !== "none" && sel.unitId === unit.id) {
        return;
      }
      void getPreview(game.id, unit.id)
        .then((preview) =>
          uiDispatch({ type: "select", unitId: unit.id, preview }),
        )
        .catch(() => undefined);
      return;
    }
    if (sel.kind === "move") {
      // click enemy unit in the red overlay → stage the attack bundle
      const inAttack = overlays.attackTiles.some(
        (t) => t[0] === unit.x && t[1] === unit.y,
      );
      if (inAttack) {
        uiDispatch({
          type: "stage",
          action: { type: "attack", targetId: unit.id },
        });
      }
    }
  };

  const submitTurn = useCallback((): void => {
    if (game === null || submitting) {
      return;
    }
    const apply = (applied: GameState): Promise<void> => {
      if (applied.status === "won" || applied.status === "lost") {
        // 05: do NOT call /end-turn (the server would 409 it) — the overlay
        // renders directly from this response.
        setGame(applied);
        uiDispatch({ type: "reset" });
        return Promise.resolve();
      }
      uiDispatch({ type: "reset" });
      return endTurn(game.id).then(setGame);
    };
    setSubmitting(true);
    setSubmitError(null);
    postMoves(game.id, ui.staged)
      .then(apply)
      .catch((err: unknown) => {
        if (
          err instanceof ApiError &&
          err.status === 409 &&
          /already submitted/.test(err.message)
        ) {
          // This round's bundle was already applied (e.g. a previously lost
          // end-turn call) — the server's lock message means the turn can be
          // ended right away.
          apply(game).catch((e: unknown) => {
            setSubmitError(
              e instanceof ApiError ? e.message : "Something went wrong.",
            );
          });
        } else {
          setSubmitError(
            err instanceof ApiError ? err.message : "Something went wrong.",
          );
        }
      })
      .finally(() => setSubmitting(false));
  }, [game, submitting, ui.staged]);

  // Wait-staged units count as acted — only omitted units trigger the dialog (05).
  const unactedCount =
    game === null
      ? 0
      : game.units.filter(
          (u) => u.side === "player" && !u.acted && !stagedIds.has(u.id),
        ).length;

  const onEndTurn = (): void => {
    if (!interactive) {
      return;
    }
    if (unactedCount > 0) {
      setDialog("end");
      return;
    }
    submitTurn();
  };

  const onForfeitConfirm = (): void => {
    if (game === null) {
      return;
    }
    setDialog(null);
    void forfeit(game.id)
      .then(setGame)
      .catch((err: unknown) =>
        setSubmitError(
          err instanceof ApiError ? err.message : "Could not forfeit.",
        ),
      );
  };

  // Esc: movePicked → re-select; unitSelected → idle (05).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        uiDispatch({ type: "back" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (game === null || meta === null) {
    if (loadError !== null) {
      return (
        <p className="error-banner">
          {loadError} <Link to="/play">Back to the battles</Link>
        </p>
      );
    }
    return (
      <div className="page-loading">
        <span className="spinner" role="status" aria-label="Loading" />
      </div>
    );
  }

  const playerUnits = game.units.filter((u) => u.side === "player");
  const shownUnits = anim !== null ? anim.units : game.units;

  return (
    <section className="board-page">
      <PhaseBanner game={game} meta={meta} />
      <StagedMovesBar
        staged={ui.staged}
        units={game.units}
        meta={meta}
        onUnstage={(unitId) => uiDispatch({ type: "unstage", unitId })}
      />
      <div className="board-layout">
        <Board
          boardSize={meta.boardSize}
          tiles={game.board.tiles}
          units={shownUnits}
          themeId={user.theme}
          stagedUnitIds={stagedIds}
          overlays={overlays}
          popups={anim?.popups ?? []}
          onTileClick={onTileClick}
          onUnitClick={onUnitClick}
        />
        <div className="board-side">
          <ActionPanel
            meta={meta}
            themeId={user.theme}
            selectedUnit={selectedUnit}
            selection={ui.selection}
            attackTargets={unitsAt(overlays.attackTiles, "enemy")}
            healTargets={unitsAt(overlays.healTiles, "player")}
            onBack={() => uiDispatch({ type: "back" })}
            onStage={(action: MoveAction) =>
              uiDispatch({ type: "stage", action })
            }
          />
          <UnitTray
            units={playerUnits}
            meta={meta}
            themeId={user.theme}
            selectedUnitId={selectedUnit?.id ?? null}
            stagedUnitIds={stagedIds}
            onSelect={onUnitClick}
          />
        </div>
      </div>
      {submitError !== null && (
        <div className="error-banner" role="alert">
          {submitError}
        </div>
      )}
      <TurnFooter
        onEndTurn={onEndTurn}
        onForfeit={() => setDialog("forfeit")}
      />

      {dialog === "end" && (
        <ConfirmDialog
          title={`${unactedCount} unit(s) have not acted`}
          body="End the turn anyway? The un-acted units simply skip this turn."
          confirmLabel="End turn"
          cancelLabel="Keep acting"
          onConfirm={() => {
            setDialog(null);
            submitTurn();
          }}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === "forfeit" && (
        <ConfirmDialog
          title="Forfeit this battle?"
          body="The battle will be recorded as a defeat."
          confirmLabel="Forfeit"
          cancelLabel="Keep fighting"
          danger
          onConfirm={onForfeitConfirm}
          onCancel={() => setDialog(null)}
        />
      )}
      {(game.status === "won" || game.status === "lost") && (
        <div
          className={`end-overlay ${game.status === "won" ? "end-won" : "end-lost"}`}
          role="dialog"
          aria-label={game.status === "won" ? "Victory" : "Defeat"}
        >
          <div className="card end-card">
            <h2 className="display">
              {game.status === "won" ? "Victory" : "Defeat"}
            </h2>
            <Link className="btn btn-primary" to="/play">
              Back to the battles
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
