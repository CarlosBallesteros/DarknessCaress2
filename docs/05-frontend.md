# Frontend — the Website

> Pure React SPA per `01-architecture.md`. Every state-change comes from a `06-api-contract.md` endpoint response (wholesale replacement of the local GameState — no optimistic mutations beyond cosmetic selection previews). Plain CSS with design tokens; no UI framework.

## Routes (React Router)

| Path | Page | Auth | Contents |
|---|---|---|---|
| `/` | Landing | public | Title `"Darkness Caress II"` (h1), tagline `The long awaited sequel to the legendary game`, one button `Play` (→ `/play` or `/login`). Full-viewport hero: art via `assetPath(DEFAULT_THEME, "hero")` — `DEFAULT_THEME` = the first `themes[].id` served by the public `GET /api/meta` — dark overlay regardless of UI mode (placeholder ships with it — see `07`). |
| `/login` | Login | public | Email + password form, error banner on 401/429. Link to `/register`. |
| `/register` | Register | public | Email, username, password, password-again. Client checks length/format per `01`. Link to `/login`. |
| `/play` | Game strip | yes | "Game" tab home: scroll-snap strip in creation order. See below. |
| `/play/:id` | Board | yes | The battle screen. See below. |
| `/stats` | Statistics | yes | Table from `GET /api/stats`: totals row + per-difficulty table. |
| `/champions` | Champions | yes | 6 class cards from `GET /api/meta`. See below. |
| `/profile` | Profile | yes | 3 forms. See below. |

`ProtectedRoute` component: on mount calls `GET /api/me`; on 401 redirects to `/login` (state back-link included). While loading: minimal spinner, nothing else. After any `401` caught by the api wrapper app-wide: same redirect.

**Top menu** (all authed pages): left — wordmark "Darkness Caress II"; center — tabs `Game · Statistics · Champions · Profile` (active tab underlined gold); right — `ui-mode-toggle` (sun/moon icon), username (link to `/profile`) + `Log out` button (`POST /api/auth/logout` → `/`). Wraps to two rows under 480 px.

**Light/dark UI mode:** pure client feature — a tiny `useUiMode` hook sets `data-ui-mode="dark"|"light"` on `<html>`, persisted under `localStorage` key `dc.uiMode`, **default dark** (no API, no profile write; a later hook may persist it per-account). Tokens are split so semantic tokens (backgrounds, text, borders) have light-mode overrides in `:root[data-ui-mode="light"]`; game/side colors (gold, blood, board tiles, overlays) are identical in both modes.

## Games strip (`/play`)

- Fetches `GET /api/games` + `GET /api/meta` (for persona labels + cap).
- **Presentation — the strip, not a list:** games render in a horizontal, snap-scrolling strip (CSS `scroll-snap`; arrows on desktop, native swipe on touch; dots + keyboard arrows as input). No carousel library — plain CSS per doctrine.
- **Order = creation order** (`06` endpoint 9): game 1 stays leftmost forever; there is no reshuffling, ever. **Finished games stay in their slot, dimmed** (Victory/Defeat badge visible, board preview greyed). Only ≤ 5 cards are ever vivid (the active cap).
- **Poll every 3 s while any game's status is `ai_turn`** (custom hook `usePolling(fn, active)` — `active` switches polling; no cross-tab or visibility-API fanciness).
- Each card: persona label badge (`--persona-<id>` accent, same tokens as the board banner), status badge (`Your turn` gold / `AI is thinking…` red pulse / `Victory` gold-solid / `Defeat` red-solid), `Turn 7`, relative `updated_at`. Click the focused card → `/play/:id`; **active** cards also carry a ⋮ menu with `Forfeit` (confirm dialog → `POST /api/games/:id/forfeit`); finished cards have no ⋮ (the server would 409). A small board thumbnail on the card is a later hook — cards keep status decor only for MVP.
- **Last tile always = "New battle" card** (persona pick modal opens from there; coherent metaphor, zero extra chrome) — disabled with tooltip `Limit of 5 active games reached` when count ≥ cap ("the server is still the authority on 409"). `Create` → `POST /api/games` (loading state: "The battlefield is being designed…" — this POST legitimately runs 10–60 s) → redirect into the created game.
- Route table label: `/play` is the **"Game strip"** (Game tab home).
- Empty state: single "New battle" tile with the caption "No battles yet" beneath it.
- New-game failure handling: a `503` from `POST /api/games` ("Battlefield generation failed") shows an inline error in the modal ("The battlefield could not be designed — try again"); other errors surface in the modal's error banner. The loading state ("The battlefield is being designed…") has NO timeout — the POST legitimately runs 10–60 s.

## Board screen (`/play/:id`)

The richest screen; decomposed into the components below. Board = CSS grid, `boardSize × boardSize` from `GET /api/meta` (15×15 baseline), tile size scales via `min(40px, (100vw−32px)/boardSize)`. Units are absolutely-positioned images over the grid (one layer, transform positions — no re-mount on move).

### Board components

```
BoardScreen
├── TopMenu
├── PhaseBanner       # persona label badge (--persona-<id> accent), turn number, status,
│                     # "The darkness is thinking…" pulse when ai_turn
├── Board             # tiles grid + <UnitSprite/> layer + overlay layer
│   └── UnitSprite    # img sprite + side tint ring + 3px health bar under it (width = hp/maxHp;
│                     # >2/3 green, 1/3–2/3 amber, <1/3 red; full-HP bar hidden); dimmed when acted
├── UnitTray          # horizontal list of player units (display order per 00): class icon, hp bar,
│                     # acted state; click = select (equivalent to clicking sprite)
├── ActionPanel       # contextual: header = selected unit's portrait (assetPath portrait-player
│                     # + class label + hp/atk/def mini-stats from GET /api/meta) then the staged move
│                     # summary + buttons (Cancel staged / Attack <target> / Heal <target> /
│                     # Wait) OR prompts to click the board
├── StagedMovesBar    # chips: "Archer #1 → (7,9) attack Mage"; click chip = unstage it
└── TurnFooter        # [End turn] (primary; ALWAYS enabled — semantics in Notes) , [Forfeit]
```

Health-bar thresholds (boundary-exact): fraction = hp/maxHp; **green if fraction > 2/3; amber if 1/3 ≤ fraction ≤ 2/3; red if fraction < 1/3; hidden at full HP.**

### Interaction state machine (exact)

```
idle → unitSelected            (click own, non-acted unit → GET preview; unit gets selected ring; overlay draws)
unitSelected → unitSelected    (click another own non-acted unit → re-select)
unitSelected → idle            (click empty/dim area or Esc)
unitSelected → movePicked      (click a moveTile → client computes + displays the shortest legal path
                                via a tiny client BFS over the preview's reachable tiles — pure UX
                                sugar whose output is RE-VALIDATED server-side — and the SAME path
                                goes into the staged move;
                                overlay now shows the actions FROM THAT destination: attackTiles/red,
                                healTiles/green — the preview's union is FILTERED client-side by
                                pure arithmetic: a preview enemy tile survives only if Manhattan
                                distance(destination, enemy) ∈ that class's range list (the range
                                lives in /api/meta — no server call, no duplicated pathfinding))
movePicked → staged            (click enemy unit in red overlay → stage a whole Move bundle exactly as
                                `02`/`06` define it: {unitId, path, action:{type:"attack",targetId}} —
                                same shape for heal (targetId = own unit) and for wait ({type:"wait"}));
                                click own wounded unit in green overlay (healer) → stage heal;
                                click [Wait in place] → stage wait for same tile)
movePicked → unitSelected      ([Back] or Esc → re-select)
staged → staged                (more units staged; unstage via chip click cancels ONLY that staged move)
staged → playerTurnSubmitted   ([End turn] → POST /moves (staged list) → POST /end-turn → status ai_turn)
playerTurnSubmitted → staged   (POST /moves returned 400 → error banner with the exact engine message;
                                the staged bundle stays intact for fixing — failed attempts do not
                                consume the once-per-round budget)
playerTurnSubmitted → polling  (3 s GET /play/:id while ai_turn)
```

Notes:

- **End turn semantics**: choreography is UNIFORM — always `POST /moves` (even an empty staged list sends `{"moves": []}` — a valid, applying-nothing submission) → then `POST /end-turn`. Button always enabled; confirm dialog only when un-acted units remain. Dialog copy, pinned: header "`<n>` unit(s) have not acted", body "End the turn anyway? The un-acted units simply skip this turn.", buttons [End turn] / [Keep acting]. Wait-staged units count as acted (only omitted units trigger the dialog).
- Victory short-circuit: the authoritative win check is SERVER-side — if `POST /moves`'s response body carries `game.status = "won"` (all enemies died by these moves), do NOT call `/end-turn` (the server would 409 it; status matrix in `06`) and show the victory overlay directly from that same response.
- `ai_turn` state: board interactions disabled; PhaseBanner pulses; on the response that flips to `player_turn`, animate `lastAiActions` client-side: step through actions 400 ms apart moving sprites along their `path` and flashing attacks (damage popups), then settle to final state (which is already authoritative).
- Sprite asset path: `/assets/${theme}/${class}/sprite-${side}.png` where `theme` = user's theme from `GET /api/me`. Portraits (Champions tab) per `07`.

### Overlays (colors are design tokens)

| Overlay | Token | Meaning |
|---|---|---|
| moveTiles | `--overlay-move` (gold, 25% alpha) | reachable destinations |
| attackTiles | `--overlay-attack` (red, 25%) | enemies attackable this turn |
| healTiles | `--overlay-heal` (green, 25%) | allies healable this turn |
| selected unit ring | `--overlay-select` (white) | currently selected unit |

## Champions tab (`/champions`)

`GET /api/meta` → 6 cards (2×3 grid, 1 col under 700 px). Card: role badge first (small pill: `Attacker` gold-tinted, `Supporter` green-tinted — values straight from the served meta), both portraits side-by-side (`portrait-player.png` under a gold label, `portrait-enemy.png` under a red label), class label overlaid on the stat block, and the lore text. Portrait click → simple lightbox (larger view, `Esc`/click closes). No other interactivity.

## Statistics tab (`/stats`)

Totals card (renders the flat top-level numbers of `GET /api/stats`: games, win rate big numerals) + the per-difficulty table — "difficulty" is the game's persona id (`games.difficulty` per `01`'s schema), labeled via `GET /api/meta`. Empty state for 0 games: "Play your first battle." Loading/`401` handled globally. No filters, no charts.

## Profile tab (`/profile`)

Three cards, own submit button, inline success/error text (never browser alerts):

1. Username — input (current value), `Save` → `PATCH /api/me {username}`; success updates top-menu username.
2. Army theme — select from `GET /api/meta` `themes` (one option in MVP); `Save` → `PATCH /api/me {theme}`.
3. Password — current + new + repeat; `PATCH /api/me/password`. Success message "Password changed", fields clear.

## Global styles (`styles/tokens.css` — the exact palette)

```css
:root {
  /* sides & UI accents (mode-independent) */
  --gold:        #c9a227;  --gold-soft: #e2c25f;
  --white-soft:  #f2efe9;
  --blood:       #8a1c1c;  --blood-soft: #c0392b;

  /* board tiles (mode-independent) */
  --tile-plain: #c8b47a;  --tile-forest: #6f8b4f;  --tile-hill: #a08553;
  --tile-lake:  #4b7ec2;  --tile-river:  #4f97c4;  --tile-bridge: #8d6b3f;
  --tile-rock:  #6e6659;

  /* overlays: see table above */
  --overlay-move: 201 162 39;  /* rgb triplets used in rgba() */
  --overlay-attack: 192 57 43;
  --overlay-heal: 96 176 120;
  --overlay-select: 242 239 233;

  /* health bar states */
  --hp-green: #5cb85c;  --hp-amber: #e0a800;  --hp-red: #d9534f;

  /* persona accents (mode-independent; used by game-strip cards + board PhaseBanner) */
  --persona-aggressive: #c0392b;   /* red        */
  --persona-defensive:  #4b7ec2;   /* blue       */
  --persona-erratic:    #8a6fa8;   /* purple     */
}

/* semantic tokens — the ONLY things light mode re-skins */
:root, :root[data-ui-mode="dark"] {
  --ink:        #14121a;      /* page background      */
  --ink-raised: #201d29;      /* cards                */
  --ink-border: #37324a;
  --text:       #ded9e8;  --text-dim: #9a94ad;
}
:root[data-ui-mode="light"] {
  --ink:        #efe9dc;      /* parchment, not white */
  --ink-raised: #f7f2e8;
  --ink-border: #cfc3a9;
  --text:       #33302a;  --text-dim: #6b6355;
}
```

Font: system stack, display headers in `Georgia, 'Times New Roman', serif` for the dark-fantasy flavor. No web fonts.

## API client (`src/api/`)

One module family: `request<T>(path, opts)` wrapper → `fetch` with `credentials: "include"` (same-origin anyway), JSON body, error envelope unwrap (`{error}` → thrown `ApiError{status,message}`); thin typed functions per endpoint from `06`. DTO types in `src/types/` mirror `06` — the contract doc is the source they're transcribed from.

## Tests (front)

- **Vitest**: api wrapper (mock fetch → mapping/errors), `usePolling` (fake timers: starts/stops), board path-SERIALIZING helper (a tiny client BFS over the server's preview tiles, purely to produce/visualize the staged bundle's path — the server re-derives legality on submission), staged-moves reducer (state machine transitions incl. unstage).
- **Playwright** (phase 7, `09`): full flows via the real app + mock-LLM server.
- All interactive elements carry `data-testid`: `tab-game`, `new-game`, `persona-{id}`, `game-card-{id}`, `unit-{id}`, `tile-{x}-{y}`, `end-turn`, `staged-chip-{n}`, `forfeit`, `logout`, `ui-mode-toggle`. E2E specs rely on these names — stable contract, do not rename.
