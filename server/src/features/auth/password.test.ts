import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password hashing", () => {
  it("hashes and verifies a password", async () => {
    const hash = await hashPassword("correct-horse");
    expect(hash).not.toBe("correct-horse");
    expect(hash.startsWith("$2")).toBe(true);
    await expect(verifyPassword("correct-horse", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});
