import { describe, expect, it } from "vitest";
import { boardBriefSchema, type BoardBrief } from "./briefSchema";
import { FALLBACK_BRIEF, FALLBACK_SEED } from "./fallback";
import { generateBoardWithRetries, tryMaterializeValid } from "./generate";
import { materializeBoard } from "./materialize";
import { validateBoard } from "./invariants";
import { spawnArmies } from "./spawn";
import { gameEngineConfig } from "../../game/config";
import type { LlmClient } from "../ai/llmClient";

function riverBrief(i: number): BoardBrief {
  return {
    river: {
      startRow: 2 + (i % 4),
      endRow: 2 + ((i + 1) % 4),
      bends: 1 + (i % 3),
    },
    bridgeTiles: i % 2 === 0 ? 1 : 2,
    forestZones: [
      { centerX: 2, centerY: 2, radius: 1 },
      ...(i % 3 === 0 ? [{ centerX: 5, centerY: 3, radius: 1 as const }] : []),
    ],
    hillZones: i % 2 === 0 ? [{ centerX: 4, centerY: 3, radius: 1 }] : [],
    lake: i % 4 === 0 ? null : { centerX: 3 + (i % 2), centerY: 3, radius: 1 },
  };
}

describe("board generation", () => {
  it("invariants property tests pass for >= 40 seeds", () => {
    const size = 8;
    for (let i = 0; i < 40; i++) {
      const brief = riverBrief(i);
      const parsed = boardBriefSchema.parse(brief);
      const seed = `seed-${i}`;
      const board = tryMaterializeValid(parsed, seed, 8, size);
      expect(board, `seed ${i} failed to produce valid board`).not.toBeNull();
      if (!board) continue;
      const err = validateBoard(board, parsed, size);
      expect(err, `seed ${i}: ${err}`).toBeNull();
    }
  });

  it("riverless-brief test passes", () => {
    const size = 8;
    const brief: BoardBrief = {
      river: null,
      bridgeTiles: 1,
      forestZones: [{ centerX: 2, centerY: 2, radius: 1 }],
      hillZones: [{ centerX: 5, centerY: 4, radius: 1 }],
      lake: { centerX: 4, centerY: 3, radius: 1 },
    };
    boardBriefSchema.parse(brief);
    const board = tryMaterializeValid(brief, "riverless-seed", 8, size);
    expect(board).not.toBeNull();
    if (!board) return;
    const err = validateBoard(board, brief, size);
    expect(err).toBeNull();

    let waterBeyondLake = 0;
    const isLakeBlob = (x: number, y: number) => {
      const dx = x - brief.lake!.centerX;
      const dy = y - brief.lake!.centerY;
      return dx * dx + dy * dy <= brief.lake!.radius * brief.lake!.radius;
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const t = board.tiles[y][x];
        if (t === "river" || t === "bridge") waterBeyondLake++;
        if (t === "lake" && !isLakeBlob(x, y)) {
          // lake only painted by blob; other tiles fine
        }
      }
    }
    expect(waterBeyondLake).toBe(0);
  });

  it("determinism test: same brief+seed = byte-identical board", () => {
    const brief = riverBrief(7);
    const a = materializeBoard(brief, "same-seed", 0).board;
    const b = materializeBoard(brief, "same-seed", 0).board;
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("fallback template validates", () => {
    const board = tryMaterializeValid(FALLBACK_BRIEF, FALLBACK_SEED, 8, 8);
    expect(board).not.toBeNull();
    if (!board) return;
    const err = validateBoard(board, FALLBACK_BRIEF, 8);
    expect(err).toBeNull();
  });

  it("retry budget comes from config (materializations: 1 stops after one attempt then regenerates/fallback)", async () => {
    // For this brief+seed, attempt 0 fails validation but attempt 1 succeeds.
    // With materializations: 1 and briefs: 1, generation must not try attempt 1
    // and must fall back (proves config budgets are honored, no hardcoded retry counts).
    const brief = riverBrief(2);
    let briefCalls = 0;
    const llm: LlmClient = {
      async chat() {
        briefCalls++;
        return brief;
      },
      async brief() {
        briefCalls++;
        return brief;
      },
    };

    const attempt0 = materializeBoard(brief, "retry-case-2", 0).board;
    expect(validateBoard(attempt0, brief, 8)).not.toBeNull();
    const attempt1 = materializeBoard(brief, "retry-case-2", 1).board;
    expect(validateBoard(attempt1, brief, 8)).toBeNull();

    const result = await generateBoardWithRetries(
      "retry-case-2",
      llm,
      {
        boardSize: 8,
        ai: {
          moveRetries: 3,
          staleAfterSeconds: 60,
          sweepIntervalSeconds: 15,
          briefTemperature: 0.8,
          boardRetries: { materializations: 1, briefs: 1 },
        },
      },
      gameEngineConfig,
    );

    expect(briefCalls).toBe(1);
    expect(result.usedFallback).toBe(true);
  });

  it("spawn scatter layout places armies per spec", () => {
    const units = spawnArmies("spawn-seed", gameEngineConfig);
    expect(units).toHaveLength(20);
    const players = units.filter((u) => u.side === "player");
    const enemies = units.filter((u) => u.side === "enemy");
    expect(players).toHaveLength(10);
    expect(enemies).toHaveLength(10);

    for (const side of ["player", "enemy"] as const) {
      const sideUnits = units.filter((u) => u.side === side);
      const frontRow = side === "player" ? 6 : 1;
      const backRow = side === "player" ? 7 : 0;
      const front = sideUnits.filter((u) => u.y === frontRow);
      const back = sideUnits.filter((u) => u.y === backRow);
      expect(front).toHaveLength(5);
      expect(back).toHaveLength(5);
      expect(front.every((u) => u.class !== "healer")).toBe(true);

      const frontClasses = front.map((u) => u.class).sort();
      const backClasses = back.map((u) => u.class).sort();
      expect(frontClasses).toEqual(["axe", "axe", "spear", "sword", "sword"].sort());
      expect(backClasses).toEqual(["archer", "archer", "healer", "mage", "spear"].sort());
      expect(sideUnits.every((u) => u.acted === false)).toBe(true);
      expect(sideUnits.every((u) => u.hp === gameEngineConfig.classes[u.class].hp)).toBe(true);
    }

    const units2 = spawnArmies("spawn-seed", gameEngineConfig);
    expect(JSON.stringify(units2)).toBe(JSON.stringify(units));

    // across many seeds arrangements vary and healer always in back row
    const arrangements = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const us = spawnArmies(`vary-${i}`, gameEngineConfig);
      const healer = us.find((u) => u.side === "player" && u.class === "healer");
      expect(healer && healer.y === 7).toBe(true);
      arrangements.add(us.map((u) => `${u.id}:${u.x},${u.y}`).join("|"));
    }
    expect(arrangements.size).toBeGreaterThan(1);
  });
});
