// statsKernel (docs/04): the emitted STATS line matches the documented format,
// is entirely config-driven (mutating the config changes the line), and stays
// independent of move-decision logic (moves are server-side policies).
import { describe, expect, it } from "vitest";
import type { GameConfig } from "../../config/load";
import { config } from "../../config/load";
import { statsKernel } from "./statsKernel";

function expectLine(key: string): RegExp {
  const cls = config.classes[key];
  const rng = cls.range.length > 0 ? cls.range.join(",") : "0";
  const heal = cls.healAmount !== undefined ? `\\/heal${cls.healAmount}` : "";
  return new RegExp(
    `(^| \\| )${key}=hp${cls.hp}/atk${cls.atk}/def${cls.def}/mov${cls.mov}/rng${rng}/role-${cls.role}${heal}( \\| |$)`,
  );
}

describe("statsKernel", () => {
  it("emits one line per class in config-key order, joined by ' | '", () => {
    const line = statsKernel(config);
    const keys = Object.keys(config.classes);
    const parts = line.split(" | ");
    expect(parts).toHaveLength(keys.length);
    parts.forEach((part, i) => expect(part.startsWith(`${keys[i]}=`)).toBe(true));
  });

  it("matches the documented format for every class (values read from config)", () => {
    const line = statsKernel(config);
    for (const key of Object.keys(config.classes)) {
      expect(line).toMatch(expectLine(key));
    }
  });

  it("renders an EMPTY range list as rng0 and appends /heal at the END", () => {
    const healer = config.classes.healer;
    expect(statsKernel(config)).toContain(
      `healer=hp${healer.hp}/atk${healer.atk}/def${healer.def}/mov${healer.mov}/rng0/role-${healer.role}/heal${healer.healAmount}`,
    );
  });

  it("changes when the config stats change (archer range [2] → [2,3])", () => {
    const mutated = structuredClone(config) as GameConfig;
    mutated.classes.archer.range = [2, 3];
    const before = statsKernel(config);
    const after = statsKernel(mutated);
    expect(after).not.toBe(before);
    expect(after).toContain("archer=hp16/atk6/def2/mov4/rng2,3/role-supporter");
  });

  it("changes when a class is added", () => {
    const mutated = structuredClone(config) as unknown as GameConfig;
    (mutated.classes as Record<string, GameConfig["classes"][keyof GameConfig["classes"]]>).dragon =
      {
        count: 1,
        hp: 30,
        atk: 9,
        def: 4,
        mov: 6,
        range: [1, 2],
        role: "attacker",
        label: "Dragon",
      };
    const line = statsKernel(mutated);
    expect(line).toContain("dragon=hp30/atk9/def4/mov6/rng1,2/role-attacker");
    expect(line.split(" | ")).toHaveLength(Object.keys(mutated.classes).length);
  });
});
