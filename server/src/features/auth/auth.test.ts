// Unit tests for the auth mechanics (docs/09 phase 2): password hashing and
// session JWT verify/expire. No HTTP, no database.
import { afterEach, describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword, BCRYPT_COST } from "./password";
import { signSession, verifySession, SESSION_COOKIE } from "./jwt";

describe("password hashing", () => {
  it("hashes with bcrypt at the documented cost (10)", async () => {
    const hash = await hashPassword("correct-horse");
    expect(hash).toMatch(/^\$2[aby]\$\d+\$/);
    expect(hash.startsWith(`$2b$${BCRYPT_COST}$`)).toBe(true);
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("correct-horse", hash)).toBe(true);
    expect(await verifyPassword("wrong-horse", hash)).toBe(false);
  });
});

describe("session JWT", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("round-trips a signed session", () => {
    const token = signSession("d0a35a26-1f7d-4d3e-9a1e-58f0e5f5d001");
    expect(verifySession(token)).toEqual({
      sub: "d0a35a26-1f7d-4d3e-9a1e-58f0e5f5d001",
    });
  });

  it("expires after 7 days", () => {
    vi.useFakeTimers();
    const start = Date.now();
    const token = signSession("d0a35a26-1f7d-4d3e-9a1e-58f0e5f5d002");

    vi.setSystemTime(start + 7 * 24 * 60 * 60 * 1000 - 1000);
    expect(verifySession(token)?.sub).toBe(
      "d0a35a26-1f7d-4d3e-9a1e-58f0e5f5d002",
    );

    vi.setSystemTime(start + 7 * 24 * 60 * 60 * 1000 + 2000);
    expect(verifySession(token)).toBeNull();
  });

  it("rejects garbage tokens", () => {
    expect(verifySession("not-a-jwt")).toBeNull();
  });

  it("names the contract cookie", () => {
    expect(SESSION_COOKIE).toBe("dc_session");
  });
});
