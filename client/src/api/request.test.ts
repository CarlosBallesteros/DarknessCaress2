import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../types";
import { request, setUnauthorizedHandler } from "./request";

describe("api request wrapper", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setUnauthorizedHandler(null);
  });

  it("returns parsed JSON on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );
    await expect(request<{ ok: boolean }>("/api/test")).resolves.toEqual({ ok: true });
  });

  it("returns undefined on 204", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(request<void>("/api/test", { method: "POST" })).resolves.toBeUndefined();
  });

  it("throws ApiError with error envelope message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Bad thing" }), { status: 400 })),
    );
    await expect(request("/api/test")).rejects.toMatchObject({ status: 400, message: "Bad thing" });
  });

  it("throws ApiError on non-json error body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    await expect(request("/api/test")).rejects.toBeInstanceOf(ApiError);
  });

  it("calls unauthorized handler on 401", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
      ),
    );
    await expect(request("/api/me")).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalled();
  });
});
