import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("hashes with bcrypt cost 10 and verifies", async () => {
    const hash = await hashPassword("correct-horse");
    expect(hash).not.toBe("correct-horse");
    expect(hash).toMatch(/^\$2[aby]\$10\$/);
    expect(await verifyPassword("correct-horse", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct-horse");
    expect(await verifyPassword("wrong-horse", hash)).toBe(false);
  });
});
