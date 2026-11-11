import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { config, loadConfigFrom } from "../config/load";
import { engineConfig, projectEngineConfig } from "../config/engine";
import { applyMoves } from "./apply";
import { reachableTiles } from "./reach";
import { SIZE, type Board, type ClassKey, type Side, type Tile, type Unit } from "./types";

// Phase-3 acceptance: "rerun with mutated config numbers in a temp file still
// passes (proves no hardcoded stats)". The mutated numbers are written to a
// temp file, loaded through the production parse + projection path, and the
// engine output is asserted against the MUTATED values — and shown to differ
// from the baseline output. Any stat inlined in the engine would break this.
const BASE = engineConfig;

let tempDir: string | undefined;
afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

function mutatedEngineConfig(): ReturnType<typeof projectEngineConfig> {
  const raw = structuredClone(config);
  raw.classes.sword.atk += 2;
  raw.classes.sword.def += 1;
  raw.classes.spear.mov += 1;
  raw.classes.healer.healAmount = (raw.classes.healer.healAmount ?? 0) + 3;
  tempDir = mkdtempSync(path.join(tmpdir(), "dc2-mutated-config-"));
  const file = path.join(tempDir, "config.json");
  writeFileSync(file, JSON.stringify(raw));
  return projectEngineConfig(loadConfigFrom(file));
}

function unit(
  cfg: ReturnType<typeof projectEngineConfig>,
  classKey: ClassKey,
  side: Side,
  x: number,
  y: number,
  overrides: Partial<Unit> = {},
): Unit {
  const cls = cfg.classes[classKey];
  return {
    id: `u${classKey}-${side}-${x}-${y}`,
    side,
    class: classKey,
    x,
    y,
    hp: cls.hp,
    maxHp: cls.hp,
    acted: false,
    ...overrides,
  };
}

function board(): Board {
  const tiles: Tile[][] = Array.from({ length: SIZE }, () =>
    Array.from({ length: SIZE }, () => "plain" as Tile),
  );
  return { tiles };
}

describe("engine with mutated config numbers (temp file)", () => {
  it("loads the mutated numbers through the production parse+project path", () => {
    const mutated = mutatedEngineConfig();
    expect(mutated.classes.sword.atk).toBe(BASE.classes.sword.atk + 2);
    expect(mutated.classes.sword.def).toBe(BASE.classes.sword.def + 1);
    expect(mutated.classes.spear.mov).toBe(BASE.classes.spear.mov + 1);
    expect(mutated.classes.healer.healAmount).toBe((BASE.classes.healer.healAmount ?? 0) + 3);
  });

  it("movement derives from the mutated mov, differing from the baseline", () => {
    const mutated = mutatedEngineConfig();
    const spear = unit(mutated, "spear", "player", 7, 7);
    const reach = reachableTiles(board(), [spear], spear, mutated);
    const m = mutated.classes.spear.mov;
    expect(reach.has(`7,${7 - m}`)).toBe(true); // distance m is now reachable…
    expect(reach.has(`7,${7 - m - 1}`)).toBe(false);
    const baseSpear = unit(BASE, "spear", "player", 7, 7);
    expect(reachableTiles(board(), [baseSpear], baseSpear, BASE).has(`7,${7 - m}`)).toBe(false);
    // …but was NOT reachable with the baseline mov
  });

  it("damage derives from the mutated atk/def, differing from the baseline", () => {
    const mutated = mutatedEngineConfig();
    const attacker = unit(mutated, "sword", "player", 7, 7);
    const defender = unit(mutated, "sword", "enemy", 7, 8);
    const result = applyMoves(
      { board: board(), units: [attacker, defender] },
      [{ unitId: attacker.id, path: [[7, 7]], action: { type: "attack", targetId: defender.id } }],
      "player",
      mutated,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const mutatedDamage = mutated.classes.sword.atk - mutated.classes.sword.def;
    const baseDamage = BASE.classes.sword.atk - BASE.classes.sword.def;
    expect(mutatedDamage).not.toBe(baseDamage); // the mutation is observable
    const attack = result.result.events.find((e) => e.kind === "attack");
    expect(attack && "damage" in attack ? attack.damage : undefined).toBe(mutatedDamage);
  });

  it("healing derives from the mutated healAmount, differing from the baseline", () => {
    const mutated = mutatedEngineConfig();
    const healer = unit(mutated, "healer", "player", 5, 7);
    const wounded = unit(mutated, "archer", "player", 5, 8, {
      hp: mutated.classes.archer.hp - 10,
    });
    const result = applyMoves(
      { board: board(), units: [healer, wounded] },
      [{ unitId: healer.id, path: [[5, 7]], action: { type: "heal", targetId: wounded.id } }],
      "player",
      mutated,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const healAmount = mutated.classes.healer.healAmount ?? 0;
    const healed = Math.min(healAmount, 10); // wound deeper than the heal
    expect(healed).not.toBe(Math.min(BASE.classes.healer.healAmount ?? 0, 10));
    const heal = result.result.events.find((e) => e.kind === "heal");
    expect(heal && "healed" in heal ? heal.healed : undefined).toBe(healed);
  });
});
