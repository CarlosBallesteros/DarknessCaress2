import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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

function convertImageToPng(src, dest) {
  const attempts = [
    ["magick", [src, dest]],
    ["magick", ["convert", src, dest]],
    ["convert", [src, dest]],
  ];
  for (const [cmd, args] of attempts) {
    const res = spawnSync(cmd, args, { stdio: "ignore" });
    if (!res.error && res.status === 0 && fs.existsSync(dest)) {
      return true;
    }
  }
  return false;
}

function readPngSize(filePath) {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(24);
      const bytes = fs.readSync(fd, buf, 0, 24, 0);
      if (bytes < 24) return null;
      if (buf.toString("hex", 0, 8) !== "89504e470d0a1a0a") return null;
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

function hasNonPlaceholderFullPortrait(filePath) {
  const size = readPngSize(filePath);
  if (!size) return false;
  return !(size.width === 512 && size.height === 768);
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
    const src = path.join(dir, entry);
    const ext = entry.toLowerCase().endsWith(".jpg") ? "jpg" : "png";
    const dest = path.join(
      assetsRoot,
      themeId,
      parsed.classKey,
      `portrait-${parsed.side}-full.png`,
    );
    ensureDir(path.dirname(dest));
    if (ext === "jpg") {
      if (convertImageToPng(src, dest)) continue;
      if (hasNonPlaceholderFullPortrait(dest)) {
        console.warn(
          `sync-art: ImageMagick unavailable, keeping existing full portrait ${dest}`,
        );
        continue;
      }
      throw new Error(
        `sync-art: failed to convert ${src} to ${dest}. Install ImageMagick (magick/convert) to convert JPG full portraits to PNG.`,
      );
    }
    copyIfExists(src, dest);
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
