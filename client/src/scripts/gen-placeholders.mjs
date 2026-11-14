import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const configPath = path.join(repoRoot, "server", "src", "config", "config.json");
const assetsRoot = path.join(repoRoot, "client", "public", "assets");

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

function hashColor(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const r = (hash & 0xff0000) >> 16;
  const g = (hash & 0x00ff00) >> 8;
  const b = hash & 0x0000ff;
  return `#${[r || 0x55, g || 0x66, b || 0x77]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("")}`;
}

function darken(hex, factor = 0.6) {
  const { r, g, b } = hexToRgb(hex);
  const toHex = (n) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r * factor)}${toHex(g * factor)}${toHex(b * factor)}`;
}

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

function fillPng(width, height, hex) {
  const png = new PNG({ width, height });
  const { r, g, b } = hexToRgb(hex);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (width * y + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

async function writeImage(filePath, width, height, hex) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, fillPng(width, height, hex));
}

async function main() {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const classKeys = Object.keys(config.classes);
  const themeId = config.themes[0]?.id ?? "warriors-europe";

  for (const cls of classKeys) {
    const base = baselinePalette[cls] ?? hashColor(cls);
    const playerColor = base;
    const enemyColor = darken(base, 0.6);
    const dir = path.join(assetsRoot, themeId, cls);
    await writeImage(path.join(dir, "portrait-player.png"), 512, 512, playerColor);
    await writeImage(path.join(dir, "portrait-enemy.png"), 512, 512, enemyColor);
    await writeImage(path.join(dir, "portrait-player-full.png"), 512, 768, playerColor);
    await writeImage(path.join(dir, "portrait-enemy-full.png"), 512, 768, enemyColor);
    await writeImage(path.join(dir, "sprite-player.png"), 128, 128, playerColor);
    await writeImage(path.join(dir, "sprite-enemy.png"), 128, 128, enemyColor);
  }

  for (const [terrain, color] of Object.entries(terrainColors)) {
    await writeImage(path.join(assetsRoot, "terrain", `${terrain}.png`), 128, 128, color);
  }

  await writeImage(path.join(assetsRoot, "hero", "landscape.png"), 1920, 1080, "#201d29");
}

await main();
