import { describe, expect, it } from "vitest";
import { getConfig, type AppConfig } from "../../config/config.js";
import { statsKernel } from "./statsKernel.js";

function withClasses(entries: AppConfig["classes"]): AppConfig {
  return { ...getConfig(), classes: entries };
}

describe("statsKernel (04: the config-rendered STATS block)", () => {
  it("renders one | separated segment per class in config-key order", () => {
    const config = getConfig();
    const segments = statsKernel(config).split(" | ");
    expect(segments).toHaveLength(Object.keys(config.classes).length);
    expect(segments.map((s) => s.split("=")[0])).toEqual(
      Object.keys(config.classes),
    );
  });

  it("matches the documented format, empty range as rng0, heal at the END", () => {
    const config = getConfig();
    const segments = Object.fromEntries(
      statsKernel(config)
        .split(" | ")
        .map((segment) => [segment.split("=")[0], segment]),
    );
    for (const [key, stats] of Object.entries(config.classes)) {
      const range = stats.range.length > 0 ? stats.range.join(",") : "0";
      const heal =
        stats.healAmount !== undefined ? `/heal${stats.healAmount}` : "";
      expect(segments[key]).toBe(
        `${key}=hp${stats.hp}/atk${stats.atk}/def${stats.def}/mov${stats.mov}/rng${range}/role-${stats.role}${heal}`,
      );
    }
    // the healer at baseline: no attack range, healAmount last after /role
    expect(segments.healer).toMatch(/\/rng0\/role-supporter\/heal\d+$/);
  });

  it("tracks a mutated range list (04 test 5: archer [2] → [2,3])", () => {
    const config = getConfig();
    const mutated = withClasses({
      ...config.classes,
      archer: { ...config.classes.archer, range: [2, 3] },
    });
    const segment = statsKernel(mutated)
      .split(" | ")
      .find((s) => s.startsWith("archer="));
    expect(segment).toBe(
      `archer=hp${mutated.classes.archer.hp}/atk${mutated.classes.archer.atk}/def${mutated.classes.archer.def}/mov${mutated.classes.archer.mov}/rng2,3/role-${mutated.classes.archer.role}`,
    );
  });

  it("emits a segment for an ADDED class (04 test 5)", () => {
    const config = getConfig();
    const mutated = withClasses({
      ...config.classes,
      wisp: {
        count: 1,
        hp: 9,
        atk: 3,
        def: 1,
        mov: 6,
        range: [2, 4],
        role: "supporter",
        label: "Wisp",
      },
    });
    const segments = statsKernel(mutated).split(" | ");
    expect(segments).toHaveLength(Object.keys(mutated.classes).length);
    expect(segments.at(-1)).toBe(
      "wisp=hp9/atk3/def1/mov6/rng2,4/role-supporter",
    );
  });

  it("follows a role retag (04 test 6: mage → attacker)", () => {
    const config = getConfig();
    const mutated = withClasses({
      ...config.classes,
      mage: { ...config.classes.mage, role: "attacker" },
    });
    const segment = statsKernel(mutated)
      .split(" | ")
      .find((s) => s.startsWith("mage="));
    expect(segment).toContain("/role-attacker");
  });
});
