# Assets — the Contract (not a build task)

> Agents DO NOT generate artwork. Agents build the asset **pipeline** (paths, resolution logic, placeholder files) so the product runs complete; the OWNER drops real art into the convention whenever he likes. This file is the contract both sides rely on.

## Directory layout (under `client/public/assets/`)

```
client/public/assets/
├── warriors-europe/            # theme id = directory name (config.themes)
│   ├── hero/
│   │   └── landscape.png       # landing page backdrop, 1920x1080 max
│   └── <class>/                # one directory per class key present in config.classes
│       ├── portrait-player.png # 512x512, player-side artwork (white/gold)
│       ├── portrait-enemy.png  # 512x512, enemy-side artwork (black/red), DIFFERENT art from player's
│       ├── sprite-player.png   # 128x128, in-game board sprite
│       └── sprite-enemy.png    # 128x128 — same design as sprite-player.png, recolored black/red
```

`<class>` = every class key present in **`config.classes`** — never a frozen list of names in code or docs (baseline config happens to contain: `sword`, `axe`, `spear`, `archer`, `mage`, `healer`; if the config ever grows or renames a class, the file tree and every consumer follow it automatically).

Side sprites: the two sprite files MUST be the same design/silhouette with different color treatment (this is the readability rule from `00` — the board reader tells friend from foe by shape-plus-tint in a blink). If the owner uses one base sprite, the recolor step must ship both files; the pipeline never recolors at runtime.

## Rules the pipeline enforces (`client/src/components/` + loader)

- All access via **one helper** `assetPath(themeId, kind, classKey?, side?)`: kinds = `portrait` | `sprite` | `hero`; `portrait`/`sprite` require a class key and a side (`player` | `enemy` → `-player`/`-enemy` filename suffix), `hero` takes neither → returns `/assets/{themeId}/hero/landscape.png` or `/assets/{themeId}/{classKey}/{kind}-{side}.png`. No component ever hardcodes `/assets/…` with a theme or class name pasted in — theme/class always come from config/api state.
- Format: PNG with alpha (RGBA) always, whatever the tool exports (owner converts if needed). Filenames lower-case, exact, never renamed.
- If an expected file is missing at runtime, the component renders its **placeholder fallback**: a flat colored rectangle — gray base `#8d8d8d` with the class's first letter printed in the tile text color, and the side tint ring applied for sprites — plus exactly one `console.warn`. Never a broken image icon, never a crash. (Fallback colors are client-side UI tokens, not config — they exist purely until real art arrives.)
- Landing hero uses `object-fit: cover`; sprites render at ~40 px inside tiles (`image-rendering: pixelated` NOT used — sprites are painterly, not pixel-art).

## Placeholder files (agents ship these)

`client/scripts/gen-placeholders.mjs` — a Node script using **`pngjs`** (the only image-related dependency allowed, dev-only) generates every file in the tree above with flat solid colors. **It reads `config.json` and iterates the class keys** — no class list of its own:

- portraits: 512×512 solid color per class+side; the per-class color comes from a small palette map for the baseline keys (sword `#7a86a8`, axe `#a87b4f`, spear `#7aa87b`, archer `#a8a37a`, mage `#8a6fa8`, healer `#a8d0c0`), and any class key NOT in the map gets a **deterministic hash-derived color** — so a future config change never forces script edits. player = the class color as-is, enemy = the SAME color darkened 40% — flat fills, no rings, no gradients;
- sprites: 128×128 same pair colors;
- hero: 1920×1080 `#201d29`.

Script is idempotent, runs on `npm run gen:placeholders` (client), and is part of phase 1's scaffold. Later real art simply overwrites the files; script never runs again in prod.

## Adding a future theme (the extensibility test — exactly 3 steps)

1. Create `client/public/assets/<newThemeId>/…` with **4 files per class key present in `config.classes` + the hero landscape** (baseline config ⇒ 25 files).
2. Add `{ "id": "<newThemeId>", "label": "<human name>" }` to `config.json` → `themes`.
3. Nothing else. Profile picker lists it (`GET /api/meta` reads config). If any file is missing, the fallback in the loader covers it until art arrives.

If more than 3 steps are needed to add a theme, the implementation is WRONG — the convention above is the requirement.

## Owner guidance → `docs/10-prompts.md`, Template T6

Everything about **how to produce the art** — the consistency kit, per-side palettes, per-class subjects, prompt seeds, and the post-drop checklist — lives in `10-prompts.md` Template **T6** (owner-only). This file deliberately does NOT contain art guidance: it is the technical contract the *pipeline* needs, nothing more. If new art requirements appear, they change T6 (owner-facing) and, only if they affect files/naming/plumbing, this file's sections above.
