# Frontend — the Website

> Pure React SPA per `01-architecture.md`. Every state-change comes from a `06-api-contract.md` endpoint response (wholesale replacement of the local GameState — no optimistic mutations beyond cosmetic selection previews). Plain CSS with design tokens; no UI framework.

## Routes (React Router)

| Path | Page | Auth | Contents |
|---|---|---|---|
| `/` | Landing | public | Title `{ "Darkness Caress II" }` (h1), tagline `The long awaited sequel to the legendary game`, one button `Play` (→ `/play` or `/login`). Full-viewport dark background, art from `/assets/warriors-europe/hero/landscape.png` (placeholder ships with it — see `07`). |
| `/login` | Login | public | Email + password form, error banner on 401/429. Link to `/register`. |
| `/register` | Register | public | Email, username, password, password-again. Client checks length/format per `01`. Link to `/login`. |
| `/play` | Games list | yes | "Game" tab home. See below. |
| `/play/:id` | Board | yes | The battle screen. See below. |
| `/stats` | Statistics | yes | Table from `GET /api/stats`: totals row + per-difficulty table. |
| `/champions` | Champions | yes | 6 class cards from `GET /api/meta`. See below. |
| `/profile` | Profile | yes | 3 forms. See below. |

`ProtectedRoute` component: on mount calls `GET /api/me`; on 401 redirects to `/login` (state back-link included). While loading: minimal spinner, nothing else. After any `401` caught by the api wrapper app-wide: same redirect.

**Top menu** (all authed pages): left — wordmark "Darkness Caress II"; center — tabs `Game · Statistics · Champions · Profile` (active tab underlined gold); right — username (link to `/profile`) + `Log out` button (`POST /api/auth/logout` → `/`). Wraps to two rows under 480 px.

## Games list (`/play`)

- Fetches `GET /api/games` + `GET /api/meta` (for persona labels + cap).
- **Poll every 3 s while any game's status is `ai_turn`** (custom hook `usePolling(fn, active)` — `active` switches polling; no cross-tab or visibility-API fanciness).
- Each game card: persona label badge (color per persona), status badge (`Your turn` gold / `AI is thinking…` red pulse / `Victory` gold-solid / `Defeat` red-solid), `Turn 7`, relative `updated_at`. Card click → `/play/:id`. On finished games: `Open` + nothing else; on active: `Open`; menu (⋮): `Forfeit` (confirm dialog, `POST /api/games/:id/forfeit`).
- **New game button** (disabled with tooltip `Limit of 5 active games reached` when count ≥ cap — server is still the authority on 409): opens modal with the 3 persona cards + `Create` → `POST /api/games` (loading state: "The battlefield is being designed…" — this POST legitimately runs 10–60 s) → redirect into the created game.
- Empty state: "No battles yet" + the New game button.

## Board screen (`/play/:id`)

The richest screen; decomposed into the components below. Board = CSS grid, `15×15`, tile size scales via `min(40px, (100vw−32px)/15)`. Units are absolutely-positioned images over the grid (one layer, transform positions — no re-mount on move).

### Board components

```
BoardScreen
├── TopMenu
├── PhaseBanner       # turn number, status, "The darkness is thinking…" pulse when ai_turn
├── Board             # tiles grid + <UnitSprite/> layer + overlay layer
│   └── UnitSprite    # img sprite + hp pip + side tint ring; dimmed when acted
├── UnitTray          # horizontal list of player units (display order per 00): class icon, hp bar,
│                     # acted state; click = select (equivalent to clicking sprite)
├── ActionPanel       # contextual: selected unit's staged move summary + buttons (Cancel staged /
│                     # Attack <target> / Heal <target> / Wait) OR prompts to click the board
├── StagedMovesBar    # chips: "Archer #1 → (7,9) attack Mage"; click chip = unstage it
└── TurnFooter        # [End turn] (primary, disabled until ≥1 staged move… see semantics), [Forfeit]
```

### Interaction state machine (exact)

```
idle → unitSelected            (click own, non-acted unit → GET preview; unit gets selected ring; overlay draws)
unitSelected → unitSelected    (click another own non-acted unit → re-select)
unitSelected → idle            (click empty/dim area or Esc)
unitSelected → movePicked      (click a moveTile → path = client-side computed shortest path for display;
                                overlay now shows the actions FROM THAT destination: attackable/red, healable/green)
movePicked → staged            (click enemy unit in red overlay → stage {unitId, path, attack:target};
                                click own wounded unit in green overlay (healer) → stage heal;
                                click [Wait in place] → stage wait for same tile)
movePicked → unitSelected      ([Back] or Esc → re-select)
staged → staged                (more units staged; unstage via chip click cancels ONLY that staged move)
staged → playerTurnSubmitted   ([End turn] → POST /moves (staged list) → POST /end-turn → status ai_turn)
playerTurnSubmitted → polling  (3 s GET /play/:id while ai_turn)
```

Notes:

- **End turn semantics**: if staged ≤ 0 moves but some unit(s) have `acted=false`, End turn still works (they do nothing) — button always enabled, confirm dialog only when un-acted units remain.
- Victory bearers: if `POST /moves` response has status `won` (all enemies died by the player's actions) → skip end-turn (server enforces), show victory overlay.
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

`GET /api/meta` → 6 cards (2×3 grid, 1 col under 700 px). Card: both portraits side-by-side (`portrait-player.png` under a gold label, `portrait-enemy.png` under a red label), class label overlaid on the stat block, and the lore text. Portrait click → simple lightbox (larger view, `Esc`/click closes). No other interactivity.

## Statistics tab (`/stats`)

Totals card (games, win rate big numerals) + the per-difficulty table. Empty state for 0 games: "Play your first battle." Loading/`401` handled globally. No filters, no charts.

## Profile tab (`/profile`)

Three cards, own submit button, inline success/error text (never browser alerts):

1. Username — input (current value), `Save` → `PATCH /api/me {username}`; success updates top-menu username.
2. Army theme — select from `GET /api/meta` `themes` (one option in MVP); `Save` → `PATCH /api/me {theme}`.
3. Password — current + new + repeat; `PATCH /api/me/password`. Success message "Password changed", fields clear.

## Global styles (`styles/tokens.css` — the exact palette)

```css
:root {
  /* sides & UI accents */
  --gold:        #c9a227;  --gold-soft: #e2c25f;
  --white-soft:  #f2efe9;
  --blood:       #8a1c1c;  --blood-soft: #c0392b;
  --ink:         #14121a;  /* page background */
  --ink-raised:  #201d29;  /* cards */
  --ink-border:  #37324a;
  --text:        #ded9e8;  --text-dim: #9a94ad;

  /* board tiles */
  --tile-plain: #c8b47a;  --tile-forest: #6f8b4f;  --tile-hill: #a08553;
  --tile-lake:  #4b7ec2;  --tile-river:  #4f97c4;  --tile-bridge: #8d6b3f;
  --tile-rock:  #6e6659;

  /* overlays: see table above */
  --overlay-move: 201 162 39;  /* rgb triplets used in rgba() */
  --overlay-attack: 192 57 43;
  --overlay-heal: 96 176 120;
  --overlay-select: 242 239 233;
}
```

Font: system stack, display headers in `Georgia, 'Times New Roman', serif` for the dark-fantasy flavor. No web fonts.

## API client (`src/api/`)

One module family: `request<T>(path, opts)` wrapper → `fetch` with `credentials: "include"` (same-origin anyway), JSON body, error envelope unwrap (`{error}` → thrown `ApiError{status,message}`); thin typed functions per endpoint from `06`. DTO types in `src/types/` mirror `06` — the contract doc is the source they're transcribed from.

## Tests (front)

- **Vitest**: api wrapper (mock fetch → mapping/errors), `usePolling` (fake timers: starts/stops), board pathfinding display helper (client mirrors nothing — only uses server previews; test just the path-display interpolation), staged-moves reducer (state machine transitions incl. unstage).
- **Playwright** (phase 7, `09`): full flows via the real app + mock-LLM server.
- All interactive elements carry `data-testid`: `tab-game`, `new-game`, `persona-{id}`, `game-card-{id}`, `unit-{id}`, `tile-{x}-{y}`, `end-turn`, `staged-chip-{n}`, `forfeit`, `logout`. E2E specs rely on these names — stable contract, do not rename.
