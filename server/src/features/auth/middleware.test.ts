import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../db/migrate";
import { env } from "../../env";
import { resetDb } from "../../test/db";
import { wrapAsync } from "../../wrapAsync";
import { requireAuth } from "./middleware";

describe("requireAuth middleware", () => {
  const app = express();
  app.use(cookieParser());
  app.get("/protected", wrapAsync(requireAuth), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      void _next;
      if (typeof err === "object" && err !== null && "status" in err && "body" in err) {
        const status = (err as { status: number }).status;
        const body = (err as { body: unknown }).body;
        res.status(status).json(body);
        return;
      }
      res.status(500).json({ error: "Internal server error" });
    },
  );

  beforeAll(async () => {
    await migrate();
  });

  // pool is shared across the test process; do not end it here.

  it("returns 401 when cookie is missing", async () => {
    const res = await request(app).get("/protected");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("returns 401 when token is invalid", async () => {
    const res = await request(app).get("/protected").set("Cookie", ["dc_session=invalid-token"]);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });

  it("returns 401 when token subject user does not exist", async () => {
    await resetDb();
    const token = jwt.sign({ sub: "00000000-0000-0000-0000-000000000000" }, env.JWT_SECRET, {
      expiresIn: "7d",
    });
    const res = await request(app)
      .get("/protected")
      .set("Cookie", [`dc_session=${token}`]);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Not authenticated" });
  });
});
