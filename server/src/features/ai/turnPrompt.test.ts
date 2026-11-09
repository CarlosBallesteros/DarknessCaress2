import { describe, expect, it } from "vitest";
import { getConfig, type AppConfig } from "../../config/config.js";
import { plainBoard, unit } from "../../test-game.js";
import { PERSONA_BEHAVIOR_TEXTS } from "./personas.js";
import { statsKernel } from "./statsKernel.js";
import { buildTurnSystemPrompt, buildTurnUserMessage } from "./turnPrompt.js";

function rebalancedConfig(): AppConfig {
  const config = getConfig();
  return {
    ...config,
    boardSize: 12,
    classes: Object.fromEntries(
      Object.entries(config.classes).map(([key, stats]) => [
        key,
        { ...stats, hp: stats.hp + 5, mov: stats.mov + 1 },
      ]),
    ),
  };
}

describe("buildTurnSystemPrompt (04: the persona prompt)", () => {
  it("renders the doc's baseline: persona text, digest, closing oath", () => {
    const prompt = buildTurnSystemPrompt(
      PERSONA_BEHAVIOR_TEXTS.aggressive,
      getConfig().boardSize,
    );
    expect(prompt).toContain(
      "You are the commander of the BLACK army in a turn-based fantasy battle on a 15x15 grid.",
    );
    expect(prompt).toContain(
      "Coordinates: x columns 0-14 (west→east), y rows 0-14 (north→south).",
    );
    expect(prompt).toContain(
      "Your army spawns on the TOP rows (0-1); the player's army is on the BOTTOM rows (13-14).",
    );
    expect(prompt).toContain(`PERSONA: ${PERSONA_BEHAVIOR_TEXTS.aggressive}`);
    expect(prompt).toContain("RULES DIGEST:");
    expect(prompt).toContain(
      "- Each of your units once per turn: move up to its MOV tiles",
    );
    expect(prompt).toContain(
      'written "[2]" means exactly 2 — distance 1 is illegal',
    );
    expect(prompt).toContain(
      'Your units are the ones whose ids start with "E-".',
    );
    expect(prompt).toContain(
      "Above all else: be reliable about attack-range legality; your persona shapes\ntactics, never legality.",
    );
  });

  it("regenerates every grid reference from config.boardSize", () => {
    const prompt = buildTurnSystemPrompt(PERSONA_BEHAVIOR_TEXTS.defensive, 12);
    expect(prompt).toContain("battle on a 12x12 grid.");
    expect(prompt).toContain(
      "x columns 0-11 (west→east), y rows 0-11 (north→south).",
    );
    expect(prompt).toContain("BOTTOM rows (10-11).");
    expect(prompt).not.toContain("15x15");
  });

  it("the digest is stable under a stat rebalance (04 test 5: no stat literals)", () => {
    const baseline = buildTurnSystemPrompt(
      PERSONA_BEHAVIOR_TEXTS.erratic,
      getConfig().boardSize,
    );
    const rebalanced = buildTurnSystemPrompt(
      PERSONA_BEHAVIOR_TEXTS.erratic,
      rebalancedConfig().boardSize,
    );
    // only the grid refs differ; digest + persona are byte-identical
    expect(rebalanced).not.toBe(baseline);
    expect(rebalanced.replace(/12x12|0-11|10-11/g, "")).toBe(
      baseline.replace(/15x15|0-14|13-14/g, ""),
    );
    expect(baseline).not.toContain("hp20");
    expect(baseline).not.toContain("atk7");
  });
});

describe("buildTurnUserMessage (04: legend + STATS + snapshot + ask)", () => {
  it("carries the config-rendered STATS line and the serialized snapshot", () => {
    const config = getConfig();
    const board = plainBoard(config.boardSize);
    const units = [
      unit("E-sword-1", "enemy", "sword", 5, 1, 20),
      unit("P-sword-1", "player", "sword", 4, 13, 20),
    ];
    const message = buildTurnUserMessage(board, units, config);
    // the kernel's line is the ONLY config-derived block, inlined verbatim
    expect(message).toContain(`STATS: ${statsKernel(config)}`);
    expect(message).toContain(
      "BOARD (15x15): each row is one string of 15 chars.",
    );
    expect(message).toContain(
      "  . plain | f forest | h hill | L lake | r rock | ~ river | B bridge",
    );
    expect(message).toContain("BOARD:\n...............");
    expect(message).toContain("E-sword-1=sword 5,1 20/20");
    expect(message).toContain("P-sword-1=sword 4,13 20/20");
    expect(message).toContain(
      "Produce THIS TURN's orders for ALL your surviving units.",
    );
    expect(message).toContain(
      "- attack targets must be PLAYER units (P-…); heal targets are your own wounded units.",
    );
  });

  it("the board block has exactly boardSize rows of boardSize glyphs", () => {
    const config = rebalancedConfig();
    const message = buildTurnUserMessage(
      plainBoard(config.boardSize),
      [],
      config,
    );
    const boardBlock = message.split("BOARD:\n")[1]?.split("\n\nUNITS:")[0];
    const rows = boardBlock?.split("\n") ?? [];
    expect(rows).toHaveLength(config.boardSize);
    for (const row of rows) {
      expect(row).toHaveLength(config.boardSize);
      expect(row).toMatch(/^[.fhLr~B]*$/);
    }
  });
});
