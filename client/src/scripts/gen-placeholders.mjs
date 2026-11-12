import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, "../..");
const repoRoot = path.resolve(clientRoot, "..");
const configPath = path.join(repoRoot, "server/src/config/config.json");
const assetsRoot = path.join(clientRoot, "public/assets");

const baselinePalette = {
  sword: "#7a86a8",
  axe: "#a87b4f",
  spear: "#7aa87b",
  archer: "#a8a37a",
  mage: "#8a6fa8",
  healer: "#a8d0c0",
};

const terrainColors = {
  plain: "#c8b47a",
  forest: "#6f8b4f",
  hill: "#a08553",
  lake: "#4b7ec2",
  river: "#4f97c4",
  bridge: "#8d6b3f",
  rock: "#6e6659",
};

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function darken(rgb, factor) {
  return {
    r: Math.max(0, Math.min(255, Math.round(rgb.r * factor))),
    g: Math.max(0, Math.min(255, Math.round(rgb.g * factor))),
    b: Math.max(0, Math.min(255, Math.round(rgb.b * factor))),
  };
}

function hashColor(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const r = 64 + ((hash & 0xff) % 160);
  const g = 64 + (((hash >> 8) & 0xff) % 160);
  const b = 64 + (((hash >> 16) & 0xff) % 160);
  return { r, g, b };
}

function classColor(classKey) {
  const hex = baselinePalette[classKey];
  return hex ? hexToRgb(hex) : hashColor(classKey);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeSolidPng(filePath, width, height, rgb) {
  ensureDir(path.dirname(filePath));
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      png.data[idx] = rgb.r;
      png.data[idx + 1] = rgb.g;
      png.data[idx + 2] = rgb.b;
      png.data[idx + 3] = 255;
    }
  }
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function main() {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const classes = Object.keys(config.classes ?? {});
  const themeId = config.themes?.[0]?.id ?? "warriors-europe";

  // Universal terrain (7 files)
  for (const [tile, hex] of Object.entries(terrainColors)) {
    writeSolidPng(path.join(assetsRoot, "terrain", `${tile}.png`), 128, 128, hexToRgb(hex));
  }

  // Universal hero
  writeSolidPng(path.join(assetsRoot, "hero", "landscape.png"), 1920, 1080, hexToRgb("#201d29"));

  // Theme army files: 6 per class
  for (const classKey of classes) {
    const player = classColor(classKey);
    const enemy = darken(player, 0.6);
    const dir = path.join(assetsRoot, themeId, classKey);
    writeSolidPng(path.join(dir, "portrait-player.png"), 512, 512, player);
    writeSolidPng(path.join(dir, "portrait-enemy.png"), 512, 512, enemy);
    writeSolidPng(path.join(dir, "portrait-player-full.png"), 512, 768, player);
    writeSolidPng(path.join(dir, "portrait-enemy-full.png"), 512, 768, enemy);
    writeSolidPng(path.join(dir, "sprite-player.png"), 128, 128, player);
    writeSolidPng(path.join(dir, "sprite-enemy.png"), 128, 128, enemy);
  }

  console.log(
    `Generated placeholders: ${classes.length * 6} theme files, ${Object.keys(terrainColors).length} terrain files, 1 hero file.`,
  );
}

main();
