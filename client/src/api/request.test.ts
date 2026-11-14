import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./request";

describe("api request wrapper", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.history.replaceState({}, "", "/");
    vi.restoreAllMocks();
  });

  it("sends credentials and JSON content-type for bodies and returns parsed JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, value: 7 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const data = await request<{ ok: boolean; value: number }>("/api/test", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
    });

    expect(data).toEqual({ ok: true, value: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/test");
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("unwraps API error envelopes into ApiError with status and message", async () => {
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: "Bad thing" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(request("/api/bad")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      message: "Bad thing",
    });
    await expect(request("/api/bad")).rejects.toBeInstanceOf(ApiError);
  });

  it("surfaces 401 on public routes without redirect when probe suppressed", async () => {
    window.history.replaceState({}, "", "/login");
    const assignMock = vi.fn();
    const originalLocation = window.location;
    const locationShim = {
      ...originalLocation,
      pathname: "/login",
      search: "",
      assign: assignMock,
    } as unknown as Location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: locationShim,
    });
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 }),
      ) as unknown as typeof fetch;

    try {
      await expect(request("/api/me", { suppressAuthRedirect: true })).rejects.toMatchObject({
        status: 401,
        message: "Not authenticated",
      });
      expect(assignMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        value: originalLocation,
      });
    }
  });
});
