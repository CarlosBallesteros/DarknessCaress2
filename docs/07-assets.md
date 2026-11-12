# Assets — the Contract (not a build task)

> Agents DO NOT generate artwork. Agents build the asset **pipeline** (paths, resolution logic, placeholder files) so the product runs complete; the OWNER drops real art into the convention whenever he likes. This file is the contract both sides rely on.

## Directory layout (under `client/public/assets/`)

```
client/public/assets/
├── terrain/                     # UNIVERSAL battlefield terrain — NOT theme-dependent
│   │                            # (the board's landscape does not change with the army's outfit)
│   ├── plain.png                # base tile, mostly covered by CSS colors
│   ├── forest.png
│   ├── hill.png
│   ├── lake.png
│   ├── river.png
│   ├── bridge.png                # art: planks/stone crossing NORTH-SOUTH over east-west water
│   └── rock.png
├── hero/                        # UNIVERSAL cinematic landing backdrop — not theme-branded:
│   │                            # the landing page is pre-login, PRE-theme-choice; an arbitrary
│   │                            # theme's banner there would greet players with a world
│   │                            # they never chose. The landing shows THE GAME's face.
│   └── landscape.png            # 1920x1080 max
├── fonts/                       # OWNER-supplied display fonts (UI-wide, universal)
│   │                            # LICENSE — SAFE TO SHIP, no agent action needed: the family is
│   │                            # "Blackletter" by Dieter Steffmann, sourced from dafont (Gothic >
│   │                            # Medieval) with dafont's "100% Free" license tag = unrestricted use,
│   │                            # commercial included. Not "free for personal use". Full provenance
│   │                            # is recorded in the staging table below. Agents: use these files
│   │                            # as-is; never substitute a CDN font, never regenerate them.
│   ├── Blackletter-ExtraBold.woff2   # THE game-title font: wordmark (top menu) + landing h1
│   └── Blackletter-Shadow.woff2      # secondary display font: section headings, panel headers
├── warriors-europe/             # theme id = directory name (config.themes) — ARMY cosmetics only
│   └── <class>/                 # one directory per class key present in config.classes
│       ├── portrait-player.png        # 512x512 SQUARE, player-side artwork (white/gold)
│       ├── portrait-enemy.png         # 512x512 SQUARE, enemy-side artwork (black/red), DIFFERENT art
│       ├── portrait-player-full.png   # 512x768 RECTANGULAR full-art — lightbox-only (Champions tab)
│       ├── portrait-enemy-full.png    # 512x768 RECTANGULAR full-art — lightbox-only (Champions tab)
│       ├── sprite-player.png          # 128x128, in-game board sprite
│       └── sprite-enemy.png           # 128x128 — same design as sprite-player.png, recolored black/red
```

`<class>` = every class key present in **`config.classes`** — never a frozen list of names in code or docs (baseline config happens to contain: `sword`, `axe`, `spear`, `archer`, `mage`, `healer`; if the config ever grows or renames a class, the file tree and every consumer follow it automatically).

**`terrain/`, `hero/`, and `fonts/` are a "WORLD vs ARMY" split, deliberately OUTSIDE `warriors-europe/` (owner corrections during play-testing):** the board's landscape doesn't change with the selected army theme, and neither does the landing page's cinematic face — the landing page is pre-login and PRE-theme-choice, so nothing theme-branded may appear there. The army theme (units, portraits) is the only theme-dependent art. Seven terrain files, one per tile code, same tile names as `02`/`06` (`plain`, `forest`, `hill`, `lake`, `river`, `bridge`, `rock`).

Side sprites: the two sprite files MUST be the same design/silhouette with different color treatment (this is the readability rule from `00` — the board reader tells friend from foe by shape-plus-tint in a blink). If the owner uses one base sprite, the recolor step must ship both files; the pipeline never recolors at runtime.

## Rules the pipeline enforces (`client/src/components/` + loader)

- All access via **one helper** `assetPath(kind, classKey?, side?, tileType?)`: kinds = `portrait` | `portrait-full` | `sprite` | `hero` | `terrain`. `portrait`/`portrait-full`/`sprite` take the USER'S theme + class + side (`portrait` returns `/assets/{themeId}/{classKey}/portrait-{side}.png` — the SQUARE, used everywhere in UI; `portrait-full` returns the same with the `-full` suffix — the RECTANGULAR full-art, used ONLY by the Champions-tab lightbox); `hero` takes neither — and deliberately NO theme (returns `/assets/hero/landscape.png`, the universal backdrop); `terrain` also takes neither (returns `/assets/terrain/{tileType}.png`). No component ever hardcodes `/assets/…` with a theme or class name pasted in — theme/class always come from config/api state.
- Format: PNG with alpha (RGBA) always, whatever the tool exports (owner converts if needed). Filenames lower-case, exact, never renamed. TERRAIN and FONT files are universal asset-level art — see the tree above; the OWNER also supplies the display fonts (self-hosted woff2 — the Blackletter pair by Dieter Steffmann, dafont "100% Free"; no CDN loads, provenance recorded in the staging table).
- If an expected file is missing at runtime, the component renders its **placeholder fallback**: a flat colored rectangle — gray base `#8d8d8d` with the class's first letter printed in the tile text color, and the side tint ring applied for sprites — plus exactly one `console.warn`. Never a broken image icon, never a crash. TERRAIN fallback = the CSS tile colors from `05`'s tokens (the sprite versions replace them one type at a time). (Fallback colors are client-side UI tokens, not config — they exist purely until real art arrives.)
- Landing hero uses `object-fit: cover`; sprites render at ~40 px inside tiles (`image-rendering: pixelated` NOT used — sprites are painterly, not pixel-art).

## Placeholder files (agents ship these)

`client/scripts/gen-placeholders.mjs` — a Node script using **`pngjs`** (the only image-related dependency allowed, dev-only) generates every file in the trees above with flat solid colors. **It reads `config.json` and iterates the class keys** — no class list of its own:

- portraits: 512×512 solid color per class+side; the per-class color comes from a small palette map for the baseline keys (sword `#7a86a8`, axe `#a87b4f`, spear `#7aa87b`, archer `#a8a37a`, mage `#8a6fa8`, healer `#a8d0c0`), and any class key NOT in the map gets a **deterministic hash-derived color** — so a future config change never forces script edits. player = the class color as-is, enemy = the SAME color darkened 40% (all RGB channels × 0.6) — flat fills, no rings, no gradients; the script ALSO generates the lightbox art: `portrait-{side}-full.png` at 512×768, same colors (so the lightbox never breaks on placeholder builds);
- sprites: 128×128 same pair colors;
- THE TERRAIN SET is generated too (universal `terrain/` folder, placeholder colors = the `05` token palette per type: plain `#c8b47a`, forest `#6f8b4f`, hill `#a08553`, lake `#4b7ec2`, river `#4f97c4`, bridge `#8d6b3f`, rock `#6e6659`);
- hero: 1920×1080 `#201d29` at **`assets/hero/landscape.png`** (universal — never inside a theme folder); **FONTS are never generated** — they are owner-supplied woff2 files.

Script is idempotent, runs on `npm run gen:placeholders` (client), and is part of phase 1's scaffold. Later real art simply overwrites the files; script never runs again in prod.

## Adding a future theme (the extensibility test — exactly 3 steps)

1. Create `client/public/assets/<newThemeId>/…` with **6 files per class key present in `config.classes`** (baseline config ⇒ 36 theme files — the landing hero (`assets/hero/`) is UNIVERSAL, never duplicated per theme; so are `terrain/` and `fonts/`, which are NOT inside themes and not part of the theme-count math). The 6: `portrait-player.png`, `portrait-enemy.png` (square), `portrait-player-full.png`, `portrait-enemy-full.png` (rectangular lightbox art), `sprite-player.png`, `sprite-enemy.png`.
2. Add `{ "id": "<newThemeId>", "label": "<human name>" }` to `config.json` → `themes`.
3. Nothing else. Profile picker lists it (`GET /api/meta` reads config). If any file is missing, the fallback in the loader covers it until art arrives.

If more than 3 steps are needed to add a theme, the implementation is WRONG — the convention above is the requirement.

## In-repo art source & automatic sync

Final/working art lives **inside the repo** at `art/` (relative to the repo root) so builds are portable and can apply art without manual copy steps. `client/scripts/sync-art.mjs` (`npm -w client run sync:art`, and run automatically as part of `npm -w client run build`) copies/transforms the mapped files into `client/public/assets/` when present. The sync is idempotent and skips missing sources (placeholders remain), so terrain and other unmapped assets can stay as placeholders until art arrives. Builds that include `art/` therefore ship the synced assets; builds without it (or run before syncing in isolated rebuild contexts) keep the placeholder baseline.

| Art source (`art/`, in-repo) | Final destination (`client/public/assets/`) | Notes |
|---|---|---|
| `landing_background/landing.png` | `hero/landscape.png` | universal, NOT theme-branded |
| `unit_images_cropped/{side}_{class}_cropped.png` | `warriors-europe/{class}/portrait-{side}.png` | the SQUARE, used everywhere in UI |
| `unit_images_full/{side}_{class}.png` (preferred) or `.jpg` | `warriors-europe/{class}/portrait-{side}-full.png` | RECTANGULAR lightbox art; prefer storing a real PNG in `art/`. Non-PNG sources are not copied over an existing `.png` destination to avoid mislabeled files. |
| `unit_images_sprites/{side}_{class}_sprite.png` | `warriors-europe/{class}/sprite-{side}.png` | in-game board sprites (player/enemy), referenced by `assetPath("sprite", ...)` |
| `font/*.woff2` | `fonts/*.woff2` | all in-repo woff2 fonts are synced (available to the build); the UI's configured display fonts are the Blackletter pair per this doc when present |

Filename transforms: `{side}_{class}_cropped.png` → `portrait-{side}.png`; `{side}_{class}.{png|jpg}` → `portrait-{side}-full.png`; `{side}_{class}_sprite.png` → `sprite-{side}.png` (side = `player`/`enemy`, class keys per `config.classes`). Still optional/missing until supplied: `terrain/` (7 files) — placeholders cover them.

> **Rebuild rounds:** if a future orchestrator rebuild needs sub-agents isolated from real art, run builds without the `art/` contents or before syncing; the placeholder pipeline (`gen:placeholders`) remains the baseline.

## Owner guidance → `docs/10-prompts.md`, Template T6

Everything about **how to produce the art** — the consistency kit, per-side palettes, per-class subjects, prompt seeds, and the post-drop checklist — lives in `10-prompts.md` Template **T6** (owner-only). This file deliberately does NOT contain art guidance: it is the technical contract the *pipeline* needs, nothing more. If new art requirements appear, they would change T6 (owner-facing) and, only if they affect files/naming/plumbing, this file's sections above.
