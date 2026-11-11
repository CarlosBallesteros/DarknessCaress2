import request from "supertest";
import { describe, expect, it } from "vitest";
import { createServer } from "../../app";
import { config } from "../../config/load";

// Contract tests per docs/06 endpoint 7: meta is deliberately public and its
// body is the config's public subset — asserted against the LOADED config
// (never hardcoded numbers), plus the docs' structural rules.
const app = createServer();

describe("GET /api/meta", () => {
  it("is reachable without any session cookie (deliberately public)", async () => {
    const res = await request(app).get("/api/meta");
    expect(res.status).toBe(200);
  });

  it("serves the top-level field set per docs/06", async () => {
    const res = await request(app).get("/api/meta");
    expect(Object.keys(res.body).sort()).toEqual(
      ["boardSize", "classes", "lore", "maxActiveGames", "personalities", "themes"].sort(),
    );
    expect(res.body.boardSize).toBe(config.boardSize);
    expect(res.body.maxActiveGames).toBe(config.maxActiveGames);
  });

  it("serves EVERY class in config with exactly the docs/06 fields", async () => {
    const res = await request(app).get("/api/meta");
    expect(Object.keys(res.body.classes).sort()).toEqual(
      ["archer", "axe", "healer", "mage", "spear", "sword"].sort(),
    );
    for (const [id, c] of Object.entries(config.classes)) {
      const served = res.body.classes[id];
      expect(served).toEqual({
        label: c.label,
        hp: c.hp,
        atk: c.atk,
        def: c.def,
        mov: c.mov,
        range: c.range,
        role: c.role,
        count: c.count,
        ...(c.healAmount !== undefined ? { healAmount: c.healAmount } : {}),
      });
    }
  });

  it("serves personalities as label-only objects (no temperature)", async () => {
    const res = await request(app).get("/api/meta");
    expect(res.body.personalities).toEqual(
      Object.fromEntries(
        Object.entries(config.personalities).map(([id, p]) => [id, { label: p.label }]),
      ),
    );
  });

  it("serves themes (id + label) and per-class lore from config", async () => {
    const res = await request(app).get("/api/meta");
    expect(res.body.themes).toEqual(config.themes);
    expect(res.body.lore).toEqual(config.lore);
    expect(Object.keys(res.body.lore).sort()).toEqual(
      ["archer", "axe", "healer", "mage", "spear", "sword"].sort(),
    );
  });
});
