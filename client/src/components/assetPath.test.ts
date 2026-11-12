import { describe, it, expect } from "vitest";
import { assetPath } from "./assetPath";

describe("assetPath", () => {
  it("builds square portrait paths for player and enemy", () => {
    expect(assetPath("portrait", "sword", "player")).toBe(
      "/assets/warriors-europe/sword/portrait-player.png",
    );
    expect(assetPath("portrait", "axe", "enemy")).toBe(
      "/assets/warriors-europe/axe/portrait-enemy.png",
    );
  });

  it("builds full-art portrait paths", () => {
    expect(assetPath("portrait-full", "mage", "player")).toBe(
      "/assets/warriors-europe/mage/portrait-player-full.png",
    );
  });

  it("builds sprite paths", () => {
    expect(assetPath("sprite", "healer", "enemy")).toBe(
      "/assets/warriors-europe/healer/sprite-enemy.png",
    );
  });

  it("builds the universal hero path", () => {
    expect(assetPath("hero")).toBe("/assets/hero/landscape.png");
  });

  it("builds terrain paths", () => {
    expect(assetPath("terrain", undefined, undefined, "lake")).toBe("/assets/terrain/lake.png");
    expect(assetPath("terrain", undefined, undefined, "bridge")).toBe("/assets/terrain/bridge.png");
  });
});
