// Placeholder-asset generator per docs/07-assets.md.
//
// Flat solid colors only — the OWNER drops real art into client/public/assets
// later and this script never runs again (docs/07: "part of phase 1's
// scaffold... never runs again in prod"). It reads config.json and iterates the
// class keys and themes — no class or theme list of its own. Fonts are
// owner-supplied and are NEVER generated.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PNG } from "pngjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, "..");
const assetsDir = path.join(clientDir, "public", "assets");
const configPath = path.resolve(clientDir, "..", "server", "src", "config", "config.json");

// Baseline per-class placeholder palette from docs/07; any class key not in the
// map gets a deterministic hash-derived color, so a future config change never
// forces script edits.
const CLASS_COLORS = {
  sword: "#7a86a8",
  axe: "#a87b4f",
  spear: "#7aa87b",
  archer: "#a8a37a",
  mage: "#8a6fa8",
  healer: "#a8d0c0",
};

// Terrain placeholder palette = the docs/05 token colors (docs/07).
const TERRAIN_COLORS = {
  plain: "#c8b47a",
  forest: "#6f8b4f",
  hill: "#a08553",
  lake: "#4b7ec2",
  river: "#4f97c4",
  bridge: "#8d6b3f",
  rock: "#6e6659",
};

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

// Deterministic fallback color for class keys outside the baseline palette.
function hashColor(key) {
  let hash = 0;
  for (const ch of key) {
    hash = (hash * 31 + ch.codePointAt(0)) % 360;
  }
  const hue = (hash / 360) * 6;
  const sector = Math.floor(hue);
  const frac = hue - sector;
  const value = 0.65;
  const chroma = 0.28;
  const pairs = [
    [1, frac, 0],
    [1 - frac, 1, 0],
    [0, 1, frac],
    [0, 1 - frac, 1],
    [frac, 0, 1],
    [1, 0, 1 - frac],
  ];
  const [r, g, b] = pairs[sector];
  const scale = (x) => Math.round((chroma * x + (value - chroma)) * 255);
  return [scale(r), scale(g), scale(b)];
}

// Enemy art = the SAME class color darkened 40% (all RGB channels × 0.6).
function darken([r, g, b]) {
  return [Math.round(r * 0.6), Math.round(g * 0.6), Math.round(b * 0.6)];
}

function writePng(relPath, width, height, [r, g, b]) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  const file = path.join(assetsDir, relPath);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, PNG.sync.write(png));
}

function classColor(key) {
  return CLASS_COLORS[key] ? hexToRgb(CLASS_COLORS[key]) : hashColor(key);
}

function generate() {
  const config = JSON.parse(readFileSync(configPath, "utf8"));

  // Theme cosmetics: 6 files per class per theme (docs/07 layout table).
  let count = 0;
  for (const theme of config.themes) {
    for (const classKey of Object.keys(config.classes)) {
      const player = classColor(classKey);
      const enemy = darken(player);
      const dir = `${theme.id}/${classKey}`;
      // Square portraits (512x512), everywhere in UI
      writePng(`${dir}/portrait-player.png`, 512, 512, player);
      writePng(`${dir}/portrait-enemy.png`, 512, 512, enemy);
      // Rectangular full-art (512x768), Champions-tab lightbox only
      writePng(`${dir}/portrait-player-full.png`, 512, 768, player);
      writePng(`${dir}/portrait-enemy-full.png`, 512, 768, enemy);
      // Board sprites (128x128), same design both sides — side tint only
      writePng(`${dir}/sprite-player.png`, 128, 128, player);
      writePng(`${dir}/sprite-enemy.png`, 128, 128, enemy);
      count += 6;
    }
  }

  // Universal terrain (never theme-dependent)
  for (const [tile, hex] of Object.entries(TERRAIN_COLORS)) {
    writePng(`terrain/${tile}.png`, 256, 256, hexToRgb(hex));
    count++;
  }

  // Universal cinematic landing backdrop (never theme-branded)
  writePng("hero/landscape.png", 1920, 1080, hexToRgb("#201d29"));
  count++;

  console.log(`Generated ${count} placeholder asset files under client/public/assets/`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generate();
}
