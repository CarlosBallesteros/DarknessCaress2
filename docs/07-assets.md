# Assets — the Contract (not a build task)

> Agents DO NOT generate artwork. Agents build the asset **pipeline** (paths, resolution logic, placeholder files) so the product runs complete; the OWNER drops real art into the convention whenever he likes. This file is the contract both sides rely on.

## Directory layout (under `client/public/assets/`)

```
client/public/assets/
└── warriors-europe/            # theme id = directory name (config.themes)
    ├── hero/
    │   └── landscape.png       # landing page backdrop, 1920x1080 max
    └── <class>/
        ├── portrait-player.png # 512x512, player-side artwork (white/gold)
        ├── portrait-enemy.png  # 512x512, enemy-side artwork (black/red), DIFFERENT art from player's
        ├── sprite-player.png   # 128x128, in-game board sprite
        └── sprite-enemy.png    # 128x128 — same design as sprite-player.png, recolored black/red
```

`<class>` = `sword`, `axe`, `spear`, `archer`, `mage`, `healer` — always the config's class keys, never display names.

Side sprites: the two sprite files MUST be the same design/silhouette with different color treatment (this is the readability rule from `00` — the board reader tells friend from foe by shape-plus-tint in a blink). If the owner uses one base sprite, the recolor step must ship both files; the pipeline never recolors at runtime.

## Rules the pipeline enforces (`client/src/components/` + loader)

- All access via **one helper** `assetPath(themeId, kind, variant)`: kinds = `portrait` | `sprite` | `hero`; the helper returns `/assets/{themeId}/{…}`. No component ever hardcodes `/assets/…` with a theme or class name pasted in — theme/class always come from config/api state.
- Format: PNG with alpha (RGBA) always, whatever the tool exports (owner converts if needed). Filenames lower-case, exact, never renamed.
- If an expected file is missing at runtime, the component renders its **placeholder fallback** (see below) and logs one `console.warn` — never a broken image icon, never a crash.
- TableHero/landing uses `object-fit: cover`; sprites render at ~40 px inside tiles (`image-rendering: pixelated` NOT used — sprites are painterly, not pixel-art).

## Placeholder files (agents ship these)

`client/scripts/gen-placeholders.mjs` — a Node script using **`pngjs`** (the only image-related dependency allowed, dev-only) generates every file in the tree above with flat solid colors:

- portraits: 512×512 solid color per class+side (class palette: sword `#7a86a8`, axe `#a87b4f`, spear `#7aa87b`, archer `#a8a37a`, mage `#8a6fa8`, healer `#a8d0c0`; sides: player keeps class color lightened + gold ring baked? NO rings — flat class color for player, the SAME class color darkened 40% for enemy);
- sprites: 128×128 same pair colors;
- hero: 1920×1080 `#201d29`.

Script is idempotent, runs on `npm run gen:placeholders` (client), and is part of phase 1's scaffold. Later real art simply overwrites the files; script never runs again in prod.

## Adding a future theme (the extensibility test — exactly 3 steps)

1. Create `client/public/assets/<newThemeId>/…` with the 24 files (6 classes × 4 + hero).
2. Add `{ "id": "<newThemeId>", "label": "<human name>" }` to `config.json` → `themes`.
3. Nothing else. Profile picker lists it (`GET /api/meta` reads config). If any file is missing, the fallback in the loader covers it until art arrives.

If more than 3 steps are needed to add a theme, the implementation is WRONG — the convention above is the requirement.

## For the owner (art generation guidance — not agent-facing)

- **Consistency kit**: generate all 6 portraits of one side in ONE conversation/run, referencing the first accepted image ("same painterly style, same armor language, same background value") so the set looks like one artist's roster; repeat for the other side; then derive sprites (or generate with the portrait as style seed).
- **Per-side brief**: player side — white/gold armor, light backgrounds, heroic poses; enemy side — black lacquer + deep red, same silhouette language, menacing poses. Same class, obviously mirrored identity ("the same soldier archetype, the other banner").
- **Per-class subjects** (keep meaningful distinctions: silhouette first): sword = balanced longsword+shield; axe = two-handed axe, heavier bulk; spear = longspear, lithe; archer = bow, mobile stance, no sword; mage = staff, bareheaded, glow accents; healer = staff+vial, soft silhouette, clearly non-combatant.
- **Portrait prompt seed** (adapt freely): "dark fantasy oil painting portrait, [subject], [armor palette], dramatic rim light, simple dark background, centered bust, 512×512" — run your image tool of choice at 1:1.
- **Sprite prompt seed**: "full body game sprite of [subject], dark fantasy painterly style, neutral pose, front view, flat simple background, centered, 1:1" — crop tight; the board shows it tiny, so favor big readable shapes over detail.
- Names of tools are the owner's business; these seeds are style guidance, not part of the build.
- Sound (later hook, `00`): same convention when it arrives — `assets/<theme>/<class>/sound-*.mp3`.
