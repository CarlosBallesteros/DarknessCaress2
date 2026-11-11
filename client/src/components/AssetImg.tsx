import { useState } from "react";
import type { AssetKind, AssetSide } from "./assets";
import { assetPath, warnMissingAsset } from "./assets";

// 07 fallback rule: a missing portrait/sprite/hero renders a flat gray
// rectangle with the class's first letter (sprites keep the side tint ring)
// and warns once — never a broken image icon, never a crash. Terrain is NOT
// handled here: its fallback is the CSS tile colors underneath (board.tsx).
interface AssetImgProps {
  themeId?: string;
  kind: AssetKind;
  classKey?: string;
  side?: AssetSide;
  alt: string;
  className?: string;
}

export function AssetImg({
  themeId,
  kind,
  classKey,
  side,
  alt,
  className,
}: AssetImgProps): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const src = assetPath(kind, classKey, side, undefined, themeId);
  if (failed) {
    warnMissingAsset(src);
    const ring = side ? ` asset-fallback-${side}` : "";
    return (
      <span role="img" aria-label={alt} className={`asset-fallback${ring} ${className ?? ""}`}>
        {classKey === undefined ? "" : classKey.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={false}
      onError={() => {
        setFailed(true);
      }}
    />
  );
}
