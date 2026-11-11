// GET /api/meta (docs/06 endpoint 7): the public config subset, field-for-field
// per the contract example. Served from the config file, never hard-coded.
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { config } from "../config/config";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

describe("GET /api/meta", () => {
  it("serves the public config subset without auth", async () => {
    const res = await request(baseUrl).get("/api/meta");
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      [
        "boardSize",
        "classes",
        "lore",
        "maxActiveGames",
        "personalities",
        "themes",
      ].sort(),
    );

    expect(res.body.boardSize).toBe(config.boardSize);
    expect(res.body.maxActiveGames).toBe(config.maxActiveGames);
    expect(res.body.themes).toEqual(config.themes);
    expect(res.body.lore).toEqual(config.lore);

    // Classes: every key, labels/stats/role/count — healAmount only where the
    // class defines one; temperatures never leak.
    expect(Object.keys(res.body.classes)).toEqual(Object.keys(config.classes));
    for (const [key, served] of Object.entries(
      res.body.classes as Record<string, Record<string, unknown>>,
    )) {
      expect(Object.keys(served).sort()).toEqual(
        key === "healer"
          ? [
              "atk",
              "count",
              "def",
              "healAmount",
              "hp",
              "label",
              "mov",
              "range",
              "role",
            ].sort()
          : [
              "atk",
              "count",
              "def",
              "hp",
              "label",
              "mov",
              "range",
              "role",
            ].sort(),
      );
    }
    expect(res.body.classes.healer.healAmount).toBe(8);

    // Personalities: labels only.
    expect(res.body.personalities).toEqual(
      Object.fromEntries(
        Object.entries(config.personalities).map(([key, persona]) => [
          key,
          { label: persona.label },
        ]),
      ),
    );
  });
});
