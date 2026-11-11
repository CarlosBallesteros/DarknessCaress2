// Prompt-layer tests (docs/04's test list 4-6): the serializer's golden
// snapshot, the STATS kernel's documented format under config mutation, and
// the prompt hygiene rule that the digest/persona prose never carries stat
// literals — only the kernel's config-rendered line does.
import { describe, expect, it } from "vitest";
import { config } from "../../config/config";
import { makeBoard, e, p } from "../../game/fixtures";
import { serializeState } from "./serialize";
import { statsKernel } from "./stats-kernel";
import { buildTurnSystemPrompt, buildTurnUserMessage } from "./turn-prompt";
import { PERSONA_BEHAVIOR_TEXTS } from "./personas";

describe("serializeState (docs/04: the exact serialized snapshot)", () => {
  it("renders the golden fixture: glyph board rows, then `id=class x,y hp/maxHp` lines", () => {
    const board = makeBoard([
      [5, 0, "forest"],
      [6, 0, "hill"],
      [7, 0, "lake"],
      [8, 0, "rock"],
      [9, 0, "river"],
      [10, 0, "bridge"],
    ]);
    const units = [
      p("P-sword-1", "sword", 4, 13, { hp: 12 }),
      e("E-spear-2", "spear", 9, 1, { hp: 7 }),
      e("E-sword-1", "sword", 5, 1, { hp: 20 }),
      e("E-axe-1", "axe", 7, 1, { hp: 25 }),
    ];
    const snapshot = serializeState(board, units);
    const rows = snapshot.split("\n");
    // top (y=0) first; the six special glyphs of row 0 at columns 5-10
    expect(rows[1]).toBe(".....fhLr~B....");
    expect(rows[0]).toBe("BOARD:");
    expect(rows[16]).toBe("");
    expect(rows[17]).toBe("UNITS:");
    // enemy army first, classes in display order (sword, axe, spear), then n
    expect(rows.slice(18)).toEqual([
      "E-sword-1=sword 5,1 20/20",
      "E-axe-1=axe 7,1 25/25",
      "E-spear-2=spear 9,1 7/18",
      "P-sword-1=sword 4,13 12/20",
    ]);
  });

  it("prints hp/maxHp verbatim from the unit state — no serializer-side stat literals", () => {
    const board = makeBoard();
    const units = [p("P-sword-1", "sword", 4, 13)];
    expect(serializeState(board, units)).toContain(
      "P-sword-1=sword 4,13 20/20",
    );
    // the values came from the unit row (created from config at game time),
    // never from a serializer literal
    expect(
      serializeState(board, [{ ...units[0], hp: 99, maxHp: 99 }]),
    ).toContain("P-sword-1=sword 4,13 99/99");
  });
});

describe("statsKernel (docs/04: the STATS format)", () => {
  it("matches the documented format for the baseline config, one line, config-key order", () => {
    expect(statsKernel(config)).toBe(
      "sword=hp20/atk7/def5/mov3/rng1/role-attacker" +
        " | axe=hp25/atk10/def3/mov2/rng1/role-attacker" +
        " | spear=hp18/atk6/def3/mov5/rng1/role-attacker" +
        " | archer=hp16/atk6/def2/mov4/rng2/role-supporter" +
        " | mage=hp15/atk8/def1/mov3/rng1,2,3/role-supporter" +
        " | healer=hp18/atk0/def2/mov2/rng0/role-supporter/heal8",
    );
  });

  it("mutating the config changes the emitted STATS line (no stat literals in code)", () => {
    const mutated = structuredClone(config);
    mutated.classes.archer.range = [2, 3];
    mutated.classes.archer.role = "attacker";
    const line = statsKernel(mutated);
    expect(line).toContain("archer=hp16/atk6/def2/mov4/rng2,3/role-attacker");
    // the healer's heal suffix stays at the END of its line, after /role
    expect(line).toContain(
      "healer=hp18/atk0/def2/mov2/rng0/role-supporter/heal8",
    );
  });

  it("an added class appears in the line; an empty range list renders as rng0", () => {
    const mutated = structuredClone(config);
    mutated.classes["extra"] = {
      count: 1,
      hp: 9,
      atk: 0,
      def: 1,
      mov: 1,
      range: [],
      role: "supporter",
      label: "Extra",
    };
    expect(statsKernel(mutated)).toContain(
      " | extra=hp9/atk0/def1/mov1/rng0/role-supporter",
    );
  });
});

describe("turn prompts (docs/04: prompt hygiene)", () => {
  it("the system prompt renders the grid references from boardSize, not literals", () => {
    const prompt = buildTurnSystemPrompt(
      PERSONA_BEHAVIOR_TEXTS.aggressive,
      config.boardSize,
    );
    expect(prompt).toContain("on a 15x15 grid");
    expect(prompt).toContain("x columns 0-14");
    expect(prompt).toContain("BOTTOM rows (13-14)");
    expect(prompt).toContain(`PERSONA: ${PERSONA_BEHAVIOR_TEXTS.aggressive}`);
    // a mutated board size re-renders every reference
    const other = buildTurnSystemPrompt("x", 9);
    expect(other).toContain("on a 9x9 grid");
    expect(other).toContain("0-8");
    expect(other).toContain("BOTTOM rows (7-8)");
  });

  it("the user message carries the legend, the STATS line, the snapshot and the ask", () => {
    const message = buildTurnUserMessage(makeBoard(), [], config);
    expect(message).toContain(
      "BOARD (15x15): each row is one string of 15 chars.",
    );
    expect(message).toContain(
      ". plain | f forest | h hill | L lake | r rock | ~ river | B bridge",
    );
    expect(message).toContain(`STATS: ${statsKernel(config)}`);
    expect(message).toContain("UNITS: BOTH armies, id=class x,y hp/maxHp");
    expect(message).toContain(
      "Produce THIS TURN's orders for ALL your surviving units.",
    );
    expect(message).toContain('{"moves":[{"unitId":"E-…"');
  });
});
