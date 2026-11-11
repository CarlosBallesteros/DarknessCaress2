import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { createServer } from "./app";

describe("GET /api/health", () => {
  let server: Server;
  let url: string;

  beforeAll(() => {
    server = createServer().listen(0);
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("server did not listen on an ephemeral port");
    }
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("returns 200 { ok: true } with no auth", async () => {
    const res = await fetch(`${url}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
