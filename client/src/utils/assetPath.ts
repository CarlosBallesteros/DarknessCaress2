type AssetKind = "portrait" | "portrait-full" | "sprite" | "hero" | "terrain";
type Side = "player" | "enemy";

export function assetPath(
  kind: AssetKind,
  themeOrClass?: string,
  classOrSide?: string,
  sideOrTile?: string,
): string {
  switch (kind) {
    case "hero":
      return "/assets/hero/landscape.png";
    case "terrain": {
      const tileType = themeOrClass ?? "plain";
      return `/assets/terrain/${tileType}.png`;
    }
    case "portrait": {
      const themeId = themeOrClass ?? "warriors-europe";
      const classKey = classOrSide ?? "sword";
      const side = (sideOrTile as Side | undefined) ?? "player";
      return `/assets/${themeId}/${classKey}/portrait-${side}.png`;
    }
    case "portrait-full": {
      const themeId = themeOrClass ?? "warriors-europe";
      const classKey = classOrSide ?? "sword";
      const side = (sideOrTile as Side | undefined) ?? "player";
      return `/assets/${themeId}/${classKey}/portrait-${side}-full.png`;
    }
    case "sprite": {
      const themeId = themeOrClass ?? "warriors-europe";
      const classKey = classOrSide ?? "sword";
      const side = (sideOrTile as Side | undefined) ?? "player";
      return `/assets/${themeId}/${classKey}/sprite-${side}.png`;
    }
    default:
      return "/assets/hero/landscape.png";
  }
}
