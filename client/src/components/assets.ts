// The single asset-path helper (07). No component ever hardcodes /assets/…
// with a theme or class name pasted in — theme/class always come from
// config/api state.
export type AssetKind = "portrait" | "sprite" | "hero";
export type AssetSide = "player" | "enemy";

export function assetPath(
  themeId: string,
  kind: AssetKind,
  classKey?: string,
  side?: AssetSide,
): string {
  if (kind === "hero") {
    return `/assets/${themeId}/hero/landscape.png`;
  }
  return `/assets/${themeId}/${String(classKey)}/${kind}-${String(side)}.png`;
}
