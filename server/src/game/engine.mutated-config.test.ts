import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { getConfig, toEngineConfig } from "../config/config.js";
import type { AppConfig } from "../config/config.js";
import { registerApplySuite, registerReachSuite } from "./engine-suite.js";
import type { GameEngineConfig } from "./types.js";

// 09 phase-3 acceptance: "rerun with mutated config numbers in a temp file
// still passes (proves no hardcoded stats)". The suite below mutates every
// stat knob (board size, hp, atk, def, mov, range shapes, healAmount),
// writes the mutant to a TEMP FILE, projects it exactly like production
// (JSON parse + toEngineConfig), and reruns the whole engine suite against it.
const mutated: AppConfig = JSON.parse(
  readFileSync(
    new URL("../config/config.json", import.meta.url),
    "utf8",
  ) as string,
) as AppConfig;

mutated.boardSize = 9;
for (const stats of Object.values(mutated.classes)) {
  stats.hp += 100;
  if (stats.range.length > 0) {
    // attackers get a different (gap-7-shape) range list; the healer keeps
    // her empty attack range — atk 0 + range [] is her semantic
    stats.atk += 3;
    stats.range = [...stats.range, Math.max(...stats.range) + 2];
  }
  stats.def += 5;
  stats.mov += 1;
  if (stats.healAmount !== undefined) {
    stats.healAmount = stats.healAmount * 3 + 1;
  }
}

const dir = mkdtempSync(join(tmpdir(), "dc2-engine-config-"));
const filePath = join(dir, "config.json");
writeFileSync(filePath, JSON.stringify(mutated, null, 2));
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const fileConfig = JSON.parse(
  readFileSync(filePath, "utf8") as string,
) as AppConfig;
const cfg: GameEngineConfig = toEngineConfig(fileConfig);

// the mutation is real — the rerun only means something if the numbers differ
it("mutated temp config actually differs from the shipped one", () => {
  expect(cfg.boardSize).not.toBe(getConfig().boardSize);
  expect(JSON.stringify(cfg)).not.toBe(
    JSON.stringify(toEngineConfig(getConfig())),
  );
});

registerReachSuite("reach — mutated temp config", cfg);
registerApplySuite("applyMoves — mutated temp config", cfg);
