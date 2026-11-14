import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(clientRoot, "..");
const artRoot = path.resolve(repoRoot, "art");
const assetsRoot = path.resolve(clientRoot, "public/assets");
const themeId = "warriors-europe";

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  return true;
}

function syncHero() {
  copyIfExists(
    path.join(artRoot, "landing_background/landing.png"),
    path.join(assetsRoot, "hero/landscape.png"),
  );
}

function syncFonts() {
  const fontDir = path.join(artRoot, "font");
  if (!fs.existsSync(fontDir)) return;
  for (const entry of fs.readdirSync(fontDir)) {
    if (!entry.toLowerCase().endsWith(".woff2")) continue;
    copyIfExists(path.join(fontDir, entry), path.join(assetsRoot, "fonts", entry));
  }
}

function parseSideClass(fileName, suffixPattern) {
  const match = fileName.match(suffixPattern);
  if (!match) return null;
  return { side: match[1], classKey: match[2] };
}

function syncCroppedPortraits() {
  const dir = path.join(artRoot, "unit_images_cropped");
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const parsed = parseSideClass(entry, /^(player|enemy)_([a-z]+)_cropped\.png$/i);
    if (!parsed) continue;
    const dest = path.join(assetsRoot, themeId, parsed.classKey, `portrait-${parsed.side}.png`);
    copyIfExists(path.join(dir, entry), dest);
  }
}

function syncFullPortraits() {
  const dir = path.join(artRoot, "unit_images_full");
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const parsed = parseSideClass(entry, /^(player|enemy)_([a-z]+)\.(png|jpg)$/i);
    if (!parsed) continue;
    const ext = entry.toLowerCase().endsWith(".jpg") ? "jpg" : "png";
    const dest = path.join(
      assetsRoot,
      themeId,
      parsed.classKey,
      `portrait-${parsed.side}-full.png`,
    );
    // Non-PNG sources are not copied over an existing .png destination.
    if (ext === "jpg" && fs.existsSync(dest)) continue;
    copyIfExists(path.join(dir, entry), dest);
  }
}

function syncSprites() {
  const dir = path.join(artRoot, "unit_images_sprites");
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    const parsed = parseSideClass(entry, /^(player|enemy)_([a-z]+)_sprite\.png$/i);
    if (!parsed) continue;
    const dest = path.join(assetsRoot, themeId, parsed.classKey, `sprite-${parsed.side}.png`);
    copyIfExists(path.join(dir, entry), dest);
  }
}

function main() {
  if (!fs.existsSync(artRoot)) {
    console.log("sync-art: no art/ directory found, skipping.");
    return;
  }
  ensureDir(assetsRoot);
  syncHero();
  syncFonts();
  syncCroppedPortraits();
  syncFullPortraits();
  syncSprites();
  console.log("sync-art: complete.");
}

main();
