// Sync in-repo art (art/ at repo root) into client/public/assets/ per docs/07.
// Idempotent: copies/overwrites mapped files when the source exists so builds
// and deploys pick up real art automatically. Missing art sources are skipped
// (placeholders remain), so the pipeline still works without art.
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(clientDir, "..");
const artDir = path.join(repoRoot, "art");
const assetsDir = path.join(clientDir, "public", "assets");

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function copyIfExists(src, destRel) {
  if (!existsSync(src)) return false;
  const dest = path.join(assetsDir, destRel);
  ensureDir(path.dirname(dest));
  copyFileSync(src, dest);
  return true;
}

function sync() {
  if (!existsSync(artDir)) {
    console.log("sync-art: no art/ directory found; keeping existing assets");
    return;
  }

  let copied = 0;

  // Fonts (universal)
  copied += copyIfExists(
    path.join(artDir, "font", "Blackletter-ExtraBold.woff2"),
    "fonts/Blackletter-ExtraBold.woff2",
  )
    ? 1
    : 0;
  copied += copyIfExists(
    path.join(artDir, "font", "Blackletter-Shadow.woff2"),
    "fonts/Blackletter-Shadow.woff2",
  )
    ? 1
    : 0;

  // Landing hero (universal)
  copied += copyIfExists(
    path.join(artDir, "landing_background", "landing.png"),
    "hero/landscape.png",
  )
    ? 1
    : 0;

  // Cropped portraits: {side}_{class}_cropped.png -> warriors-europe/{class}/portrait-{side}.png
  const croppedDir = path.join(artDir, "unit_images_cropped");
  if (existsSync(croppedDir)) {
    for (const file of readdirSync(croppedDir)) {
      const m = /^(player|enemy)_([a-z0-9]+)_cropped\.png$/i.exec(file);
      if (!m) continue;
      const [, side, cls] = m;
      if (
        copyIfExists(
          path.join(croppedDir, file),
          `warriors-europe/${cls.toLowerCase()}/portrait-${side.toLowerCase()}.png`,
        )
      ) {
        copied++;
      }
    }
  }

  // Full portraits: prefer {side}_{class}.png, fall back to .jpg (copied with .png
  // destination name; browsers may not decode a mislabeled file, so prefer real PNGs).
  const fullDir = path.join(artDir, "unit_images_full");
  if (existsSync(fullDir)) {
    for (const file of readdirSync(fullDir)) {
      const m = /^(player|enemy)_([a-z0-9]+)\.(png|jpg|jpeg)$/i.exec(file);
      if (!m) continue;
      const [, side, cls, ext] = m;
      // If a PNG exists for this base, skip non-PNG variants to prefer it.
      const base = `${side}_${cls}`;
      if (ext.toLowerCase() !== "png" && existsSync(path.join(fullDir, `${base}.png`))) {
        continue;
      }
      if (
        copyIfExists(
          path.join(fullDir, file),
          `warriors-europe/${cls.toLowerCase()}/portrait-${side.toLowerCase()}-full.png`,
        )
      ) {
        copied++;
      }
    }
  }

  console.log(`sync-art: copied ${copied} art file(s) from art/ into client/public/assets/`);
}

sync();
