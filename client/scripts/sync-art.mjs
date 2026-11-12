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

  // Fonts (universal): sync every .woff2 present in art/font so all in-repo fonts
  // are usable in builds; known display fonts keep their canonical destinations.
  const fontDir = path.join(artDir, "font");
  if (existsSync(fontDir)) {
    for (const file of readdirSync(fontDir)) {
      if (!/\.woff2$/i.test(file)) continue;
      if (copyIfExists(path.join(fontDir, file), `fonts/${file}`)) copied++;
    }
  }

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
  // To avoid clobbering a real .png asset with mislabeled JPG bytes, skip non-PNG
  // sources when a .png destination already exists.
  const fullDir = path.join(artDir, "unit_images_full");
  if (existsSync(fullDir)) {
    for (const file of readdirSync(fullDir)) {
      const m = /^(player|enemy)_([a-z0-9]+)\.(png|jpg|jpeg)$/i.exec(file);
      if (!m) continue;
      const [, side, cls, ext] = m;
      const base = `${side}_${cls}`;
      if (ext.toLowerCase() !== "png" && existsSync(path.join(fullDir, `${base}.png`))) {
        continue;
      }
      const destRel = `warriors-europe/${cls.toLowerCase()}/portrait-${side.toLowerCase()}-full.png`;
      if (ext.toLowerCase() !== "png" && existsSync(path.join(assetsDir, destRel))) {
        continue;
      }
      if (copyIfExists(path.join(fullDir, file), destRel)) copied++;
    }
  }

  // Sprites: {side}_{class}_sprite.png -> warriors-europe/{class}/sprite-{side}.png
  const spritesDir = path.join(artDir, "unit_images_sprites");
  if (existsSync(spritesDir)) {
    for (const file of readdirSync(spritesDir)) {
      const m = /^(player|enemy)_([a-z0-9]+)_sprite\.png$/i.exec(file);
      if (!m) continue;
      const [, side, cls] = m;
      if (
        copyIfExists(
          path.join(spritesDir, file),
          `warriors-europe/${cls.toLowerCase()}/sprite-${side.toLowerCase()}.png`,
        )
      ) {
        copied++;
      }
    }
  }

  console.log(`sync-art: copied ${copied} art file(s) from art/ into client/public/assets/`);
}

sync();
