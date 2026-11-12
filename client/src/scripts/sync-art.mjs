/* global process */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../../");
const CONFIG_PATH = path.join(ROOT, "server/src/config/config.json");
const ART = path.join(ROOT, "art");
const ASSETS = path.resolve(__dirname, "../../public/assets");

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
const themes = config.themes.map((t) => t.id);
const classKeys = Object.keys(config.classes);
const sides = ["player", "enemy"];

let copied = 0;
let skipped = 0;

function copy(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  return true;
}

function attempt(label, src, dest) {
  if (copy(src, dest)) {
    copied++;
    process.stdout.write(`sync-art: copied ${label}\n`);
  } else {
    skipped++;
    process.stdout.write(`sync-art: skipped ${label} (source missing)\n`);
  }
}

// Universal hero backdrop.
attempt(
  "hero",
  path.join(ART, "landing_background/landing.png"),
  path.join(ASSETS, "hero/landscape.png"),
);

// Owner-supplied display fonts.
const fontDir = path.join(ART, "font");
if (fs.existsSync(fontDir)) {
  for (const file of fs.readdirSync(fontDir)) {
    if (file.endsWith(".woff2")) {
      attempt(`fonts/${file}`, path.join(fontDir, file), path.join(ASSETS, `fonts/${file}`));
    }
  }
}

for (const themeId of themes) {
  for (const classKey of classKeys) {
    for (const side of sides) {
      attempt(
        `portrait ${themeId}/${classKey} ${side}`,
        path.join(ART, `unit_images_cropped/${side}_${classKey}_cropped.png`),
        path.join(ASSETS, themeId, classKey, `portrait-${side}.png`),
      );

      // Lightbox art: prefer a real PNG; never copy a non-PNG source over an
      // existing .png destination.
      const fullPng = path.join(ART, `unit_images_full/${side}_${classKey}.png`);
      const fullJpg = path.join(ART, `unit_images_full/${side}_${classKey}.jpg`);
      const destFull = path.join(ASSETS, themeId, classKey, `portrait-${side}-full.png`);
      if (fs.existsSync(fullPng)) {
        copy(fullPng, destFull);
        copied++;
        process.stdout.write(`sync-art: copied portrait-full ${themeId}/${classKey} ${side}\n`);
      } else if (fs.existsSync(fullJpg)) {
        if (fs.existsSync(destFull)) {
          skipped++;
          process.stdout.write(
            `sync-art: skipped portrait-full ${themeId}/${classKey} ${side} (jpg over existing png)\n`,
          );
        } else {
          copy(fullJpg, destFull);
          copied++;
          process.stdout.write(
            `sync-art: copied portrait-full ${themeId}/${classKey} ${side} (jpg)\n`,
          );
        }
      } else {
        skipped++;
        process.stdout.write(
          `sync-art: skipped portrait-full ${themeId}/${classKey} ${side} (source missing)\n`,
        );
      }

      attempt(
        `sprite ${themeId}/${classKey} ${side}`,
        path.join(ART, `unit_images_sprites/${side}_${classKey}_sprite.png`),
        path.join(ASSETS, themeId, classKey, `sprite-${side}.png`),
      );
    }
  }
}

process.stdout.write(`sync-art: complete (${copied} copied, ${skipped} skipped)\n`);
