import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config, type GameConfig } from "../config/config";
import { toEngineConfig } from "./engine-config";
import { applyMoves, checkVictory } from "./apply";
import { isPathLegal, reachableTiles } from "./reach";
import { e, makeBoard, move, p, attack, wait } from "./fixtures";
import type { GameEngineConfig } from "./types";

describe("GameEngineConfig projection", () => {
  it("projects the canonical config file, carrying only the stat fields", () => {
    const projected = toEngineConfig(config);
    expect(projected.boardSize).toBe(15);
    expect(Object.keys(projected.classes).sort()).toEqual([
      "archer",
      "axe",
      "healer",
      "mage",
      "spear",
      "sword",
    ]);
    // labels/personalities/AI knobs never reach the engine
    expect(projected.classes.sword).toStrictEqual({
      count: 2,
      hp: 20,
      atk: 7,
      def: 5,
      mov: 3,
      range: [1],
      role: "attacker",
    });
    expect(projected.classes.healer).toStrictEqual({
      count: 1,
      hp: 18,
      atk: 0,
      def: 2,
      mov: 2,
      range: [],
      healAmount: 8,
      role: "supporter",
    });
  });
});

// The no-hardcoded-stats proof (Phase 3 acceptance): rebalanced numbers are
// written to a REAL temp file, read back and projected — then the engine must
// behave exactly per the mutated file.
const tempDirs: string[] = [];

function configFromTempFile(mutations: {
  boardSize?: number;
  classes?: Partial<Record<string, Record<string, unknown>>>;
}): GameEngineConfig {
  const raw = JSON.parse(JSON.stringify(config)) as GameConfig;
  if (mutations.boardSize !== undefined) raw.boardSize = mutations.boardSize;
  for (const [klass, patch] of Object.entries(mutations.classes ?? {})) {
    Object.assign(raw.classes[klass], patch);
  }
  const dir = mkdtempSync(join(tmpdir(), "dc-engine-config-"));
  tempDirs.push(dir);
  const file = join(dir, "config.json");
  writeFileSync(file, JSON.stringify(raw, null, 2));
  // read the file back the way the loader would — the engine only ever sees
  // the projection built from these bytes
  const readBack = JSON.parse(readFileSync(file, "utf8"));
  return toEngineConfig(readBack);
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("rerun with mutated config numbers from a temp file", () => {
  it("movement, damage, counter and range all follow the mutated file", () => {
    const mutated = configFromTempFile({
      classes: {
        sword: { mov: 6, atk: 9, range: [1, 2] },
        axe: { def: 8 },
        healer: { healAmount: 3 },
      },
    });
    // movement reads mutated mov (6 instead of 3)
    const board = makeBoard();
    const sword = p("s", "sword", 5, 5);
    expect(reachableTiles(board, [sword], sword, mutated).has("11,5")).toBe(
      true,
    );
    expect(
      isPathLegal(
        board,
        [sword],
        sword,
        [
          [5, 5],
          [6, 5],
          [7, 5],
          [8, 5],
          [9, 5],
          [10, 5],
          [11, 5],
        ],
        mutated,
      ),
    ).toBeNull();
    // damage reads mutated atk/def: 9 − 8 = 1
    const axe = e("b", "axe", 6, 5);
    const result = applyMoves(
      { board, units: [sword, axe] },
      [move("s", [[5, 5]], attack("b"))],
      "player",
      mutated,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.events[0]).toStrictEqual({
      kind: "attack",
      attackerId: "s",
      targetId: "b",
      damage: 1,
      targetHp: 24,
    });
    // counter range membership also follows the file: sword range [1,2] now
    expect(result.result.events.some((ev) => ev.kind === "counter")).toBe(true);
    // heal clamps to the mutated healAmount 3
    const healer = p("h", "healer", 5, 8);
    const ally = p("a", "spear", 5, 9, { hp: 10 });
    const healed = applyMoves(
      { board, units: [healer, ally] },
      [move("h", [[5, 8]], { type: "heal", targetId: "a" })],
      "player",
      mutated,
    );
    expect(healed.ok).toBe(true);
    if (healed.ok) {
      expect(healed.result.events[0]).toStrictEqual({
        kind: "heal",
        healerId: "h",
        targetId: "a",
        healed: 3,
        targetHp: 13,
      });
    }
  });

  it("board size is derived from the config, not from a constant", () => {
    const small = configFromTempFile({ boardSize: 5 });
    const board = makeBoard();
    const sword = p("s", "sword", 1, 1);
    expect(reachableTiles(board, [sword], sword, small).has("4,1")).toBe(true);
    expect(reachableTiles(board, [sword], sword, small).has("5,1")).toBe(false);
    expect(
      isPathLegal(
        board,
        [sword],
        sword,
        [
          [1, 1],
          [0, 1],
          [0, 0],
          [0, -1],
        ],
        small,
      ),
    ).toBe("path step (0,-1) is outside the board");
    const victory = applyMoves(
      { board, units: [p("x", "sword", 0, 0)] },
      [move("x", [[0, 0]], wait)],
      "player",
      small,
    );
    expect(victory.ok).toBe(true);
    expect(checkVictory(victory.ok ? victory.result.state.units : [])).toBe(
      "player",
    );
  });
});
