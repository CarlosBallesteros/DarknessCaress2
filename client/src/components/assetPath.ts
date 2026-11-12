const DEFAULT_THEME = "warriors-europe";

type Side = "player" | "enemy";

export function assetPath(
  kind: "portrait" | "portrait-full" | "sprite" | "hero" | "terrain",
  classKey?: string,
  side?: Side,
  tileType?: string,
): string {
  switch (kind) {
    case "portrait":
      return `/assets/${DEFAULT_THEME}/${classKey}/portrait-${side}.png`;
    case "portrait-full":
      return `/assets/${DEFAULT_THEME}/${classKey}/portrait-${side}-full.png`;
    case "sprite":
      return `/assets/${DEFAULT_THEME}/${classKey}/sprite-${side}.png`;
    case "hero":
      return "/assets/hero/landscape.png";
    case "terrain":
      return `/assets/terrain/${tileType}.png`;
  }
}
