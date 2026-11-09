import { useState } from "react";
import type { AssetKind, AssetSide } from "./assets";
import { assetPath } from "./assets";

// 07 fallback rule: a missing asset renders a flat gray rectangle with the
// class's first letter (sprites keep the side tint ring) and warns EXACTLY
// once per path — never a broken image icon, never a crash.
const warned = new Set<string>();

function warnOnce(path: string): void {
  if (warned.has(path)) {
    return;
  }
  warned.add(path);
  console.warn(`asset missing: ${path} — rendering placeholder fallback`);
}

interface AssetImgProps {
  themeId: string;
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
  const src = assetPath(themeId, kind, classKey, side);
  if (failed) {
    warnOnce(src);
    const ring = side ? ` asset-fallback-${side}` : "";
    return (
      <span
        role="img"
        aria-label={alt}
        className={`asset-fallback${ring} ${className ?? ""}`}
      >
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
