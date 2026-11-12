/* global process */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../");
const CONFIG_PATH = path.join(ROOT, "server/src/config/config.json");
const ASSETS = path.resolve(__dirname, "../../public/assets");

const PALETTE = {
  sword: "#7a86a8",
  axe: "#a87b4f",
  spear: "#7aa87b",
  archer: "#a8a37a",
  mage: "#8a6fa8",
  healer: "#a8d0c0",
};

const TERRAIN = {
  plain: "#c8b47a",
  forest: "#6f8b4f",
  hill: "#a08553",
  lake: "#4b7ec2",
  river: "#4f97c4",
  bridge: "#8d6b3f",
  rock: "#6e6659",
};

const HERO_COLOR = "#201d29";

function hashColor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) - h + key.charCodeAt(i)) | 0;
  }
  const r = (h >> 16) & 0xff;
  const g = (h >> 8) & 0xff;
  const b = h & 0xff;
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function classColor(key) {
  return PALETTE[key] ?? hashColor(key);
}

function darken(color, factor = 0.6) {
  const m = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return color;
  const r = Math.round(parseInt(m[1], 16) * factor);
  const g = Math.round(parseInt(m[2], 16) * factor);
  const b = Math.round(parseInt(m[3], 16) * factor);
  const toHex = (v) => v.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parseColor(color) {
  const m = color.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

function fill(png, color) {
  const [r, g, b] = parseColor(color);
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = r;
    png.data[i + 1] = g;
    png.data[i + 2] = b;
    png.data[i + 3] = 255;
  }
}

function writePng(file, width, height, color) {
  const png = new PNG({ width, height });
  fill(png, color);
  fs.writeFileSync(file, PNG.sync.write(png));
}

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function main() {
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  const classKeys = Object.keys(config.classes);
  const themeIds = config.themes.map((t) => t.id);

  for (const themeId of themeIds) {
    for (const classKey of classKeys) {
      const dir = path.join(ASSETS, themeId, classKey);
      ensure(dir);
      const color = classColor(classKey);
      const enemy = darken(color);
      writePng(path.join(dir, "portrait-player.png"), 512, 512, color);
      writePng(path.join(dir, "portrait-enemy.png"), 512, 512, enemy);
      writePng(path.join(dir, "portrait-player-full.png"), 512, 768, color);
      writePng(path.join(dir, "portrait-enemy-full.png"), 512, 768, enemy);
      writePng(path.join(dir, "sprite-player.png"), 128, 128, color);
      writePng(path.join(dir, "sprite-enemy.png"), 128, 128, enemy);
    }
  }

  ensure(path.join(ASSETS, "terrain"));
  for (const [tile, color] of Object.entries(TERRAIN)) {
    writePng(path.join(ASSETS, "terrain", `${tile}.png`), 64, 64, color);
  }

  ensure(path.join(ASSETS, "hero"));
  writePng(path.join(ASSETS, "hero", "landscape.png"), 1920, 1080, HERO_COLOR);

  process.stdout.write(
    `gen-placeholders: ${classKeys.length} classes x ${themeIds.length} themes + terrain + hero\n`,
  );
}

main();
