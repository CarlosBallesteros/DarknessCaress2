// Endpoint tests for POST /api/games (docs/06 endpoint 10, docs/09 phase 4):
// mock-LLM full flow — auth + capability checks + synchronous board
// generation + army assembly per 03's spawn scatter layout + the cap 409.
// Runs against the real (loopback) database; LLM_MOCK=1 is injected by the
// vitest config, so the brief is the committed fixture.
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../app";
import { pool } from "../../db/pool";
import { config } from "../../config/config";
import { engineConfig } from "../../game/engine-config";
import { validateBoard, validateSpawn } from "../board/invariants";
import type { GameStateDto } from "./games.dto";

let server: Server;
let baseUrl: string;
const createdUserIds: string[] = [];

const uniqueUsername = () =>
  `u_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const uniqueEmail = () => `${randomUUID().replaceAll("-", "")}@example.com`;

function cookieOf(res: request.Response): string {
  const setCookie = res.headers["set-cookie"] as unknown as
    string[] | undefined;
  expect(setCookie, "expected a session cookie to be set").toBeDefined();
  return setCookie![0].split(";")[0];
}

async function registerUser(): Promise<request.Response> {
  const res = await request(baseUrl).post("/api/auth/register").send({
    email: uniqueEmail(),
    password: "correct-horse",
    username: uniqueUsername(),
  });
  expect(res.status).toBe(201);
  createdUserIds.push(res.body.user.id);
  return res;
}

async function createGame(
  cookie: string,
  difficulty = "aggressive",
): Promise<request.Response> {
  return request(baseUrl)
    .post("/api/games")
    .set("Cookie", cookie)
    .send({ difficulty });
}

beforeAll(async () => {
  const app = createApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await pool.query("DELETE FROM users WHERE id = ANY($1)", [createdUserIds]);
  }
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  await pool.end();
});

describe("POST /api/games", () => {
  it('401 {"error":"Not authenticated"} without a session', async () => {
    const res = await request(baseUrl)
      .post("/api/games")
      .send({ difficulty: "aggressive" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it('400 {"error":"Unknown difficulty"} for a non-config persona', async () => {
    const register = await registerUser();
    const res = await createGame(cookieOf(register), "impossible");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Unknown difficulty" });
  });

  it("creates a game: 201 GameState with armies placed per 03's spawn scatter layout", async () => {
    const register = await registerUser();
    const res = await createGame(cookieOf(register));
    expect(res.status).toBe(201);

    const game = res.body.game as GameStateDto;
    expect(Object.keys(game).sort()).toEqual(
      [
        "board",
        "difficulty",
        "id",
        "lastAiActions",
        "status",
        "turnNumber",
        "units",
        "updatedAt",
      ].sort(),
    );
    expect(game.difficulty).toBe("aggressive");
    expect(game.status).toBe("player_turn");
    expect(game.turnNumber).toBe(1);
    expect(game.lastAiActions).toBeNull();
    expect(game.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Board: 15x15 of valid tile words, all invariants hold.
    const board = game.board;
    expect(board.tiles).toHaveLength(config.boardSize);
    for (const row of board.tiles) {
      expect(row).toHaveLength(config.boardSize);
    }
    expect(
      validateBoard(
        board,
        // the mock brief fixture, verbatim (docs/04: committed fixtures)
        {
          river: { startRow: 7, endRow: 6, bends: 2 },
          bridgeTiles: 2,
          forestZones: [
            { centerX: 5, centerY: 4, radius: 2 },
            { centerX: 9, centerY: 10, radius: 2 },
          ],
          hillZones: [{ centerX: 10, centerY: 3, radius: 1 }],
          lake: { centerX: 7, centerY: 7, radius: 1 },
        },
      ),
    ).toBeNull();

    // Armies: 10 per side, ids "<P|E>-<class>-<n>", per 03's scatter layout.
    const units = game.units;
    expect(units).toHaveLength(20);
    expect(validateSpawn(board, units, engineConfig)).toBeNull();

    for (const side of ["player", "enemy"] as const) {
      const sideUnits = units.filter((unit) => unit.side === side);
      expect(sideUnits).toHaveLength(10);
      const healer = sideUnits.find((unit) => unit.class === "healer");
      expect(healer).toBeDefined();
      // healer NEVER front: player back row 14, enemy back row 0.
      expect(healer!.y).toBe(side === "player" ? 14 : 0);
      const ids = sideUnits.map((unit) => unit.id);
      expect(ids).toEqual([
        `${side === "player" ? "P" : "E"}-sword-1`,
        `${side === "player" ? "P" : "E"}-sword-2`,
        `${side === "player" ? "P" : "E"}-axe-1`,
        `${side === "player" ? "P" : "E"}-axe-2`,
        `${side === "player" ? "P" : "E"}-spear-1`,
        `${side === "player" ? "P" : "E"}-spear-2`,
        `${side === "player" ? "P" : "E"}-archer-1`,
        `${side === "player" ? "P" : "E"}-archer-2`,
        `${side === "player" ? "P" : "E"}-mage-1`,
        `${side === "player" ? "P" : "E"}-healer-1`,
      ]);
    }
  });

  it("409 on the 6th active game (cap from config)", async () => {
    const register = await registerUser();
    const cookie = cookieOf(register);
    for (let i = 0; i < config.maxActiveGames; i++) {
      const res = await createGame(
        cookie,
        i % 2 === 0 ? "aggressive" : "defensive",
      );
      expect(res.status).toBe(201);
    }
    const res = await createGame(cookie);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: `Active game limit reached (${config.maxActiveGames})`,
    });
  });
});
