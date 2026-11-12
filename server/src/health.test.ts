import { describe, expect, it } from "vitest";
import config from "./config/config.json";

describe("phase 1 scaffold", () => {
  it("loads config with expected board size", () => {
    expect(config.boardSize).toBe(8);
  });
});
