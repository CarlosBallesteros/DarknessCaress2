// The single asset-path helper (07). No component ever hardcodes /assets/…
// with a theme or class name pasted in — theme/class always come from
// config/api state.
//
// docs/07 lists the signature as assetPath(kind, classKey?, side?, tileType?)
// yet also says portrait/sprite "take the USER'S theme + class + side" — the
// theme is api state, so it rides as the explicit fifth argument; hero and
// terrain deliberately ignore it (universal, pre-theme art, 07's WORLD vs
// ARMY split).
export type AssetKind = "portrait" | "portrait-full" | "sprite" | "hero" | "terrain";
export type AssetSide = "player" | "enemy";

export function assetPath(
  kind: AssetKind,
  classKey?: string,
  side?: AssetSide,
  tileType?: string,
  themeId?: string,
): string {
  if (kind === "hero") {
    return "/assets/hero/landscape.png"; // UNIVERSAL landing backdrop, no theme
  }
  if (kind === "terrain") {
    return `/assets/terrain/${String(tileType)}.png`; // UNIVERSAL terrain set
  }
  if (kind === "portrait-full") {
    // RECTANGULAR lightbox art — the Champions-tab lightbox ONLY (05/07).
    return `/assets/${String(themeId)}/${String(classKey)}/portrait-${String(side)}-full.png`;
  }
  return `/assets/${String(themeId)}/${String(classKey)}/${kind}-${String(side)}.png`;
}

// 07 fallback rule: a missing asset warns EXACTLY once per path — never a
// broken image icon, never a crash.
const warned = new Set<string>();

export function warnMissingAsset(path: string): void {
  if (warned.has(path)) {
    return;
  }
  warned.add(path);
  console.warn(`asset missing: ${path} — rendering placeholder fallback`);
}
