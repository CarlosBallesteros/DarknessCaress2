// Sync in-repo art (art/ at repo root) into client/public/assets/ per docs/07.
// Idempotent: copies/transforms mapped files when the source exists so builds
// and deploys pick up real art automatically. Missing art sources are skipped
// (placeholders remain), so the pipeline still works without art.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(clientDir, "..");
const artDir = path.join(repoRoot, "art");
const assetsDir = path.join(clientDir, "public", "assets");
const configPath = path.join(repoRoot, "server", "src", "config", "config.json");

function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return { themes: [{ id: "warriors-europe" }], classes: {} };
  }
}

function copyIfExists(src, destRel) {
  if (!existsSync(src)) return false;
  const dest = path.join(assetsDir, destRel);
  ensureDir(path.dirname(dest));
  copyFileSync(src, dest);
  return true;
}

function tryConvertImageToPng(src, destRel) {
  if (!existsSync(src)) return false;
  const dest = path.join(assetsDir, destRel);
  ensureDir(path.dirname(dest));
  // Produce a real PNG at the destination (avoid mislabeled jpg-as-png). Windows
  // hosts can transcode via System.Drawing. Returns true only on a real conversion.
  if (process.platform === "win32") {
    try {
      const escapePs = (p) => p.replace(/'/g, "''");
      const ps = [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.Drawing; " +
          `$img=[System.Drawing.Image]::FromFile('${escapePs(src)}'); ` +
          `try { $img.Save('${escapePs(dest)}',[System.Drawing.Imaging.ImageFormat]::Png) } ` +
          "finally { $img.Dispose() }",
      ];
      execFileSync("powershell.exe", ps, { stdio: "ignore" });
      return existsSync(dest);
    } catch {
      return false;
    }
  }
  return false;
}

function copyRawImage(src, destRel) {
  if (!existsSync(src)) return false;
  const dest = path.join(assetsDir, destRel);
  ensureDir(path.dirname(dest));
  console.warn(
    `sync-art: could not convert ${path.relative(repoRoot, src)} to real PNG; copying bytes to ${destRel} (may be mislabeled)`,
  );
  copyFileSync(src, dest);
  return true;
}

function sync() {
  if (!existsSync(artDir)) {
    console.log("sync-art: no art/ directory found, skipping (placeholders remain).");
    return;
  }

  const config = readConfig();
  const themeId = config.themes?.[0]?.id ?? "warriors-europe";
  let copied = 0;

  // Landing hero (universal)
  copied += copyIfExists(path.join(artDir, "landing_background", "landing.png"), "hero/landscape.png")
    ? 1
    : 0;

  // Fonts (universal): sync every .woff2 present in art/font so all in-repo fonts
  // are available to the build (UI uses configured display fonts per docs/07).
  const fontDir = path.join(artDir, "font");
  if (existsSync(fontDir)) {
    for (const file of readdirSync(fontDir)) {
      if (!/\.woff2$/i.test(file)) continue;
      if (copyIfExists(path.join(fontDir, file), `fonts/${file}`)) copied++;
    }
  }

  // Cropped portraits (square): {side}_{class}_cropped.png -> portrait-{side}.png
  const croppedDir = path.join(artDir, "unit_images_cropped");
  if (existsSync(croppedDir)) {
    for (const file of readdirSync(croppedDir)) {
      const m = /^(player|enemy)_([a-z0-9]+)_cropped\.png$/i.exec(file);
      if (!m) continue;
      const [, side, cls] = m;
      if (
        copyIfExists(
          path.join(croppedDir, file),
          `${themeId}/${cls.toLowerCase()}/portrait-${side.toLowerCase()}.png`,
        )
      ) {
        copied++;
      }
    }
  }

  // Full portraits (rectangular): prefer {side}_{class}.png, fall back to .jpg.
  // Produce a real PNG at the destination when possible. Do not clobber an
  // existing .png destination with a mislabeled non-PNG raw copy (docs/07),
  // but DO allow a successful conversion-to-PNG to replace a placeholder .png.
  const fullDir = path.join(artDir, "unit_images_full");
  if (existsSync(fullDir)) {
    for (const file of readdirSync(fullDir)) {
      const m = /^(player|enemy)_([a-z0-9]+)\.(png|jpg|jpeg)$/i.exec(file);
      if (!m) continue;
      const [, side, cls, ext] = m;
      const base = `${side}_${cls}`;
      if (ext.toLowerCase() !== "png" && existsSync(path.join(fullDir, `${base}.png`))) {
        continue; // prefer real PNG source
      }
      const destRel = `${themeId}/${cls.toLowerCase()}/portrait-${side.toLowerCase()}-full.png`;
      if (ext.toLowerCase() === "png") {
        if (copyIfExists(path.join(fullDir, file), destRel)) copied++;
      } else {
        // Try to write a proper PNG (safe to overwrite any existing .png dest).
        if (tryConvertImageToPng(path.join(fullDir, file), destRel)) {
          copied++;
        } else if (!existsSync(path.join(assetsDir, destRel))) {
          // Raw copy fallback only when no destination exists yet.
          if (copyRawImage(path.join(fullDir, file), destRel)) copied++;
        } else {
          console.warn(
            `sync-art: skipped ${file} (cannot convert to PNG and destination already exists)`,
          );
        }
      }
    }
  }

  // Sprites: {side}_{class}_sprite.png -> sprite-{side}.png
  const spritesDir = path.join(artDir, "unit_images_sprites");
  if (existsSync(spritesDir)) {
    for (const file of readdirSync(spritesDir)) {
      const m = /^(player|enemy)_([a-z0-9]+)_sprite\.png$/i.exec(file);
      if (!m) continue;
      const [, side, cls] = m;
      if (
        copyIfExists(
          path.join(spritesDir, file),
          `${themeId}/${cls.toLowerCase()}/sprite-${side.toLowerCase()}.png`,
        )
      ) {
        copied++;
      }
    }
  }

  console.log(
    `sync-art: copied/synced ${copied} art file(s) from art/ into client/public/assets/ (theme: ${themeId}).`,
  );
}

sync();
