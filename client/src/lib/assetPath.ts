import type { ClassKey } from "../types";

type AssetKind = "portrait" | "portrait-full" | "sprite" | "hero" | "terrain";

export function assetPath(
  kind: "portrait" | "portrait-full" | "sprite",
  themeId: string,
  classKey: ClassKey,
  side: "player" | "enemy",
): string;
export function assetPath(kind: "hero"): string;
export function assetPath(kind: "terrain", tileType: string): string;
export function assetPath(
  kind: AssetKind,
  a?: string,
  b?: ClassKey,
  c?: "player" | "enemy",
): string {
  if (kind === "hero") {
    return "/assets/hero/landscape.png";
  }
  if (kind === "terrain") {
    return `/assets/terrain/${a ?? "plain"}.png`;
  }
  const themeId = a ?? "warriors-europe";
  const classKey = b ?? "sword";
  const side = c ?? "player";
  if (kind === "portrait") {
    return `/assets/${themeId}/${classKey}/portrait-${side}.png`;
  }
  if (kind === "portrait-full") {
    return `/assets/${themeId}/${classKey}/portrait-${side}-full.png`;
  }
  return `/assets/${themeId}/${classKey}/sprite-${side}.png`;
}
