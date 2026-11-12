import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(clientRoot, "..");
const artRoot = path.join(repoRoot, "art");
const assetsRoot = path.join(clientRoot, "public/assets");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

function syncLanding() {
  copyFile(
    path.join(artRoot, "landing_background", "landing.png"),
    path.join(assetsRoot, "hero", "landscape.png"),
  );
}

function syncFonts() {
  const srcDir = path.join(artRoot, "font");
  if (!fs.existsSync(srcDir)) return;
  const destDir = path.join(assetsRoot, "fonts");
  ensureDir(destDir);
  for (const entry of fs.readdirSync(srcDir)) {
    if (entry.toLowerCase().endsWith(".woff2")) {
      copyFile(path.join(srcDir, entry), path.join(destDir, entry));
    }
  }
}

function syncClassImages(themeId, srcDir, suffix, buildDestName, options = {}) {
  if (!fs.existsSync(srcDir)) return;
  for (const entry of fs.readdirSync(srcDir)) {
    const match = entry.match(/^(player|enemy)_([a-z0-9_-]+)_(cropped|sprite)\.(png)$/i);
    const fullMatch = entry.match(/^(player|enemy)_([a-z0-9_-]+)\.(png|jpg)$/i);
    let side;
    let classKey;
    let ext;
    if (suffix === "cropped" && match && match[3] === "cropped") {
      [, side, classKey, , ext] = match;
    } else if (suffix === "sprite" && match && match[3] === "sprite") {
      [, side, classKey, , ext] = match;
    } else if (suffix === "full" && fullMatch) {
      [, side, classKey, ext] = fullMatch;
    } else {
      continue;
    }

    const src = path.join(srcDir, entry);
    const dest = path.join(assetsRoot, themeId, classKey, buildDestName(side, ext.toLowerCase()));
    if (
      options.skipNonPngOverPng &&
      ext.toLowerCase() !== "png" &&
      fs.existsSync(dest) &&
      dest.toLowerCase().endsWith(".png")
    ) {
      continue;
    }
    copyFile(src, dest);
  }
}

function main() {
  const configPath = path.join(repoRoot, "server/src/config/config.json");
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const themeId = config.themes?.[0]?.id ?? "warriors-europe";

  syncLanding();
  syncFonts();
  syncClassImages(
    themeId,
    path.join(artRoot, "unit_images_cropped"),
    "cropped",
    (side) => `portrait-${side}.png`,
  );
  syncClassImages(
    themeId,
    path.join(artRoot, "unit_images_full"),
    "full",
    (side) => `portrait-${side}-full.png`,
    { skipNonPngOverPng: true },
  );
  syncClassImages(
    themeId,
    path.join(artRoot, "unit_images_sprites"),
    "sprite",
    (side) => `sprite-${side}.png`,
  );

  console.log("Art sync complete (missing sources skipped).");
}

main();
