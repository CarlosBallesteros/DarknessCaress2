import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./request";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("request", () => {
  it("returns the parsed body on success (the body IS the resource)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 }),
      ),
    );
    await expect(request<{ user: { id: string } }>("/api/me")).resolves.toEqual(
      {
        user: { id: "u1" },
      },
    );
  });

  it("maps 204 to undefined without parsing a body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await expect(
      request<void>("/api/auth/logout", { method: "POST" }),
    ).resolves.toBeUndefined();
  });

  it("throws ApiError{status, message} from the {error} envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "Turn moves already submitted" }),
            {
              status: 409,
            },
          ),
      ),
    );
    const err = await request("/api/games/x/moves", { method: "POST" }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe("Turn moves already submitted");
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 500 })),
    );
    const err = await request("/api/stats").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
    expect((err as ApiError).message).toBe("Request failed (500)");
  });

  it("sends the JSON body and credentials", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await request("/api/auth/login", {
      method: "POST",
      body: { email: "a@b.c" },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c" }),
      credentials: "include",
    });
  });
});
