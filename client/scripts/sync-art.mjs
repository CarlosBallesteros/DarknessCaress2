import { copyFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const artRoot = path.join(repoRoot, "art");
const assetsRoot = path.join(repoRoot, "client", "public", "assets");

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

async function copyIfExists(src, dest) {
  if (!(await exists(src))) return false;
  await ensureDir(path.dirname(dest));
  await copyFile(src, dest);
  return true;
}

async function syncLanding() {
  await copyIfExists(
    path.join(artRoot, "landing_background", "landing.png"),
    path.join(assetsRoot, "hero", "landscape.png"),
  );
}

async function syncFonts() {
  const srcDir = path.join(artRoot, "font");
  if (!(await exists(srcDir))) return;
  const entries = await readdir(srcDir);
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith(".woff2")) continue;
    await copyIfExists(path.join(srcDir, entry), path.join(assetsRoot, "fonts", entry));
  }
}

async function syncCroppedPortraits() {
  const srcDir = path.join(artRoot, "unit_images_cropped");
  if (!(await exists(srcDir))) return;
  const entries = await readdir(srcDir);
  for (const entry of entries) {
    const m = /^(player|enemy)_([a-z]+)_cropped\.png$/i.exec(entry);
    if (!m) continue;
    const [, side, cls] = m;
    await copyIfExists(
      path.join(srcDir, entry),
      path.join(assetsRoot, "warriors-europe", cls, `portrait-${side}.png`),
    );
  }
}

async function syncFullPortraits() {
  const srcDir = path.join(artRoot, "unit_images_full");
  if (!(await exists(srcDir))) return;
  const entries = await readdir(srcDir);
  for (const entry of entries) {
    const m = /^(player|enemy)_([a-z]+)\.(png|jpg)$/i.exec(entry);
    if (!m) continue;
    const [, side, cls, ext] = m;
    const dest = path.join(assetsRoot, "warriors-europe", cls, `portrait-${side}-full.png`);
    if (ext.toLowerCase() !== "png" && (await exists(dest))) continue;
    if (ext.toLowerCase() !== "png") continue;
    await copyIfExists(path.join(srcDir, entry), dest);
  }
}

async function syncSprites() {
  const srcDir = path.join(artRoot, "unit_images_sprites");
  if (!(await exists(srcDir))) return;
  const entries = await readdir(srcDir);
  for (const entry of entries) {
    const m = /^(player|enemy)_([a-z]+)_sprite\.png$/i.exec(entry);
    if (!m) continue;
    const [, side, cls] = m;
    await copyIfExists(
      path.join(srcDir, entry),
      path.join(assetsRoot, "warriors-europe", cls, `sprite-${side}.png`),
    );
  }
}

async function main() {
  if (!(await exists(artRoot))) return;
  await syncLanding();
  await syncFonts();
  await syncCroppedPortraits();
  await syncFullPortraits();
  await syncSprites();
}

await main();
