// Placeholder asset generator (docs/07): flat-color PNGs for every asset slot,
// so the product runs complete until the owner drops real art into the same
// layout. Idempotent; never ships a class list of its own - it reads the
// canonical config and iterates its theme ids and class keys.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const clientDir = resolve(scriptDir, '..')
const assetsDir = join(clientDir, 'public', 'assets')
const configPath = resolve(clientDir, '..', 'server', 'src', 'config', 'config.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))

// Per-class colors for the baseline keys (docs/07 palette); any class key NOT
// in the map gets a deterministic hash-derived color, so a future config change
// never forces script edits.
const CLASS_COLORS = {
  sword: [0x7a, 0x86, 0xa8],
  axe: [0xa8, 0x7b, 0x4f],
  spear: [0x7a, 0xa8, 0x7b],
  archer: [0xa8, 0xa3, 0x7a],
  mage: [0x8a, 0x6f, 0xa8],
  healer: [0xa8, 0xd0, 0xc0],
}

function hashColor(key) {
  let hash = 0
  for (const ch of key) {
    hash = (hash * 31 + ch.codePointAt(0)) >>> 0
  }
  return [hash & 0xff, (hash >>> 8) & 0xff, (hash >>> 16) & 0xff]
}

// Enemy = the same color darkened 40% (all RGB channels x 0.6), per docs/07.
function darken(rgb) {
  return rgb.map((channel) => Math.round(channel * 0.6))
}

function writePng(path, { width, height }, rgb) {
  const png = new PNG({ width, height })
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgb[0]
    png.data[i + 1] = rgb[1]
    png.data[i + 2] = rgb[2]
    png.data[i + 3] = 255
  }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, PNG.sync.write(png))
}

// Theme army files: 4 per class key present in config.classes, per theme id.
for (const theme of config.themes) {
  for (const classKey of Object.keys(config.classes)) {
    const color = CLASS_COLORS[classKey] ?? hashColor(classKey)
    for (const side of ['player', 'enemy']) {
      const fill = side === 'player' ? color : darken(color)
      writePng(join(assetsDir, theme.id, classKey, `portrait-${side}.png`), { width: 512, height: 512 }, fill)
      writePng(join(assetsDir, theme.id, classKey, `sprite-${side}.png`), { width: 128, height: 128 }, fill)
    }
  }
}

// Universal terrain set (docs/07 token palette) - not theme-dependent.
const TERRAIN_COLORS = {
  plain: [0xc8, 0xb4, 0x7a],
  forest: [0x6f, 0x8b, 0x4f],
  hill: [0xa0, 0x85, 0x53],
  lake: [0x4b, 0x7e, 0xc2],
  river: [0x4f, 0x97, 0xc4],
  bridge: [0x8d, 0x6b, 0x3f],
  rock: [0x6e, 0x66, 0x59],
}
for (const [tileType, color] of Object.entries(TERRAIN_COLORS)) {
  writePng(join(assetsDir, 'terrain', `${tileType}.png`), { width: 128, height: 128 }, color)
}

// Universal cinematic landing backdrop (docs/07) - never inside a theme folder.
// FONTS are never generated: they are owner-supplied woff2 files.
writePng(join(assetsDir, 'hero', 'landscape.png'), { width: 1920, height: 1080 }, [0x20, 0x1d, 0x29])

const themeFiles = config.themes.length * Object.keys(config.classes).length * 4
console.log(
  `gen-placeholders: wrote ${themeFiles} theme files + ${Object.keys(TERRAIN_COLORS).length} terrain files + 1 hero backdrop into client/public/assets/`,
)
