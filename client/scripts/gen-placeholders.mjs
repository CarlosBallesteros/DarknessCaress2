// Placeholder asset generator (07-assets.md). Generates every theme dir in
// config.themes with 4 flat-color PNGs per class key in config.classes plus the
// hero landscape. Idempotent: re-running overwrites the same files. Real art
// later simply overwrites these files; the script never runs in prod.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(scriptDir, "..");
const repoRoot = join(clientRoot, "..");
const assetsDir = join(clientRoot, "public", "assets");

const config = JSON.parse(
  readFileSync(
    join(repoRoot, "server", "src", "config", "config.json"),
    "utf8",
  ),
);

// Baseline palette from 07; any class key not listed here gets a
// deterministic hash-derived color so future config changes never force
// script edits.
const palette = {
  sword: "#7a86a8",
  axe: "#a87b4f",
  spear: "#7aa87b",
  archer: "#a8a37a",
  mage: "#8a6fa8",
  healer: "#a8d0c0",
};

function parseHex(hex) {
  const hexNorm = hex.replace("#", "");
  return {
    r: parseInt(hexNorm.slice(0, 2), 16),
    g: parseInt(hexNorm.slice(2, 4), 16),
    b: parseInt(hexNorm.slice(4, 6), 16),
  };
}

function hashColor(key) {
  let hash = 0;
  for (const char of key) {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  }
  // Pastel-ish band: fixed low saturation and lightness, hue from the hash.
  const hue = hash % 360;
  const sat = 0.35;
  const light = 0.6;
  const a = sat * Math.min(light, 1 - light);
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    const value = light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255);
  };
  return { r: f(0), g: f(8), b: f(4) };
}

function classColor(key) {
  return palette[key] !== undefined ? parseHex(palette[key]) : hashColor(key);
}

// Darken by 40%.
function darken({ r, g, b }) {
  return {
    r: Math.round(r * 0.6),
    g: Math.round(g * 0.6),
    b: Math.round(b * 0.6),
  };
}

function writePng(filePath, width, height, { r, g, b }) {
  mkdirSync(dirname(filePath), { recursive: true });
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (width * y + x) << 2;
      png.data[index] = r;
      png.data[index + 1] = g;
      png.data[index + 2] = b;
      png.data[index + 3] = 255;
    }
  }
  writeFileSync(filePath, PNG.sync.write(png));
}

const heroColor = parseHex("#201d29");

for (const theme of config.themes) {
  const themeDir = join(assetsDir, theme.id);
  writePng(join(themeDir, "hero", "landscape.png"), 1920, 1080, heroColor);
  for (const classKey of Object.keys(config.classes)) {
    const playerColor = classColor(classKey);
    const enemyColor = darken(playerColor);
    const classDir = join(themeDir, classKey);
    writePng(join(classDir, "portrait-player.png"), 512, 512, playerColor);
    writePng(join(classDir, "portrait-enemy.png"), 512, 512, enemyColor);
    writePng(join(classDir, "sprite-player.png"), 128, 128, playerColor);
    writePng(join(classDir, "sprite-enemy.png"), 128, 128, enemyColor);
  }
}

console.log("placeholder assets generated");
