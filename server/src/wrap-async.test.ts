import request from "supertest";
import express from "express";
import { describe, expect, it } from "vitest";
import { wrapAsync } from "./wrap-async.js";

describe("wrapAsync", () => {
  it("forwards a rejected handler to error middleware", async () => {
    const app = express();
    app.get(
      "/boom",
      wrapAsync(async () => {
        throw new Error("boom");
      }),
    );
    const res = await request(app).get("/boom");
    expect(res.status).toBe(500);
  });
});
