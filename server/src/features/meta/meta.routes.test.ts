import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../app.js";
import { getConfig } from "../../config/config.js";

const app = createApp();

describe("GET /api/meta", () => {
  it("serves the public config subset without auth", async () => {
    const res = await request(app).get("/api/meta");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        "boardSize",
        "maxActiveGames",
        "classes",
        "personalities",
        "themes",
        "lore",
      ].sort(),
    );
  });

  it("carries every class with its stats and the healer's healAmount", () => {
    return request(app)
      .get("/api/meta")
      .then((res) => {
        const config = getConfig();
        expect(Object.keys(res.body.classes).sort()).toEqual(
          Object.keys(config.classes).sort(),
        );
        expect(res.body.classes.sword).toEqual(config.classes.sword);
        expect(res.body.classes.healer).toEqual(config.classes.healer);
        expect(res.body.classes.healer.healAmount).toBe(8);
      });
  });

  it("strips persona temperatures (labels only)", async () => {
    const res = await request(app).get("/api/meta");
    expect(res.body.personalities).toEqual({
      aggressive: { label: "Aggressive" },
      defensive: { label: "Defensive" },
      erratic: { label: "Erratic" },
    });
  });
});
