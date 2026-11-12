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
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  return (
    "#" +
    [r, g, b]
      .map((n) =>
        Math.max(0, Math.min(255, Math.round(n)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function darken(hex, factor) {
  const rgb = hexToRgb(hex);
  return rgbToHex({ r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor });
}

function hashColor(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  const r = 64 + ((hash & 0xff) % 160);
  const g = 64 + (((hash >>> 8) & 0xff) % 160);
  const b = 64 + (((hash >>> 16) & 0xff) % 160);
  return rgbToHex({ r, g, b });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writePng(filePath, width, height, hex) {
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
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

function main() {
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const themeId = config.themes?.[0]?.id ?? "warriors-europe";
  const classKeys = Object.keys(config.classes ?? {});

  ensureDir(path.join(assetsRoot, "terrain"));
  for (const [tile, color] of Object.entries(terrainColors)) {
    writePng(path.join(assetsRoot, "terrain", `${tile}.png`), 128, 128, color);
  }

  ensureDir(path.join(assetsRoot, "hero"));
  writePng(path.join(assetsRoot, "hero", "landscape.png"), 1920, 1080, "#201d29");

  for (const classKey of classKeys) {
    const playerColor = baselinePalette[classKey] ?? hashColor(classKey);
    const enemyColor = darken(playerColor, 0.6);
    const classDir = path.join(assetsRoot, themeId, classKey);
    ensureDir(classDir);

    writePng(path.join(classDir, "portrait-player.png"), 512, 512, playerColor);
    writePng(path.join(classDir, "portrait-enemy.png"), 512, 512, enemyColor);
    writePng(path.join(classDir, "portrait-player-full.png"), 512, 768, playerColor);
    writePng(path.join(classDir, "portrait-enemy-full.png"), 512, 768, enemyColor);
    writePng(path.join(classDir, "sprite-player.png"), 128, 128, playerColor);
    writePng(path.join(classDir, "sprite-enemy.png"), 128, 128, enemyColor);
  }

  console.log(
    `Generated placeholders: ${classKeys.length} classes, theme "${themeId}", terrain, and hero.`,
  );
}

main();
