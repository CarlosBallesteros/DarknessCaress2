# Darkness Caress II — Project Overview

> **Read this first.** This document is the constitution of the project. Every AI agent working on any phase reads it and treats everything here as a fixed decision. If a task seems to conflict with this document, stop and ask — do not reinterpret it.

## What this is

A fully deployed website with a turn-based 1-vs-1 strategy game, in the spirit of Fire Emblem but much simpler:

> **Fire Emblem warning:** the reference is about *feel only* — square grid, small armies, turn-based tactics. Any mechanic that exists in Fire Emblem but is absent from these documents (weapon triangle, hit/crit %, terrain bonuses, promotions, fog of war, etc.) **does not exist in MVP**. The rules here are complete for MVP; future mechanics arrive only through spec text (see Later hooks).

- A human player commands an army of 10 units.
- The opponent is controlled by **server-side tactical AI** — deterministic menu-choice policies per difficulty, running asynchronously between turns over engine-generated legal options (no LLM in the move loop). The **battlefield layout** is still designed by a local LLM (Ollama) as a curiosity (board-design brief).
- Games are **not played in real time**: the player takes a turn, the AI resolves in the background, the player sees the result when it is ready. The player can maintain several concurrent games and switch between them freely.

The project's stated purpose: build and showcase a real, playable turn-based tactics product - opponent moves are instant, always-legal server-side policies (Aggressive/Cowardly/Crazy personas, ids `aggressive`/`defensive`/`erratic`), while map generation remains an LLM-authored curiosity. Simplicity of implementation is a designed feature, not a limitation.

## Editorial principle (applies to the whole docs set)

The specs are written to be **as specific as possible while staying as simple as possible**. Every doc prefers concrete artifacts over prose: folder trees, code snippets, real JSON payloads, sample prompts. Anything not specified in these docs is either:
- a gap → the agent stops and asks (see `08-agent-rules.md`), or
- an explicitly deferred idea → listed under "Later hooks" at the bottom of this file.

**Agents must not fill unspecified gaps with their own inventions and must not over-engineer.** A simple solution that meets the spec beats a clever one that exceeds it.

## The product inventory

| Piece | Decided |
|---|---|
| Landing page | Title: **"Darkness Caress II"** (final, gothic display font, OldLondon). Tagline: **"The long-awaited sequel to the legendary game"** (final). One `To Battle!` button. |
| Auth | Email + password registration, unique display username. Login with email. No email verification, no password recovery, no 2FA (see Later hooks). Full mechanics — bcrypt, JWT cookie, rate limit — in `01-architecture.md`. |
| Tabs (top menu) | **Games**, **Statistics**, **Champions**, **Store**, **Profile**. |
| Game tab | The **Games strip** — two windowed rows (`Active battles` / `Past battles`; 3 cards visible per row with left/right arrows to shift by one, no horizontal scrollbar). Active battles show in creation order (oldest left, newest right); Past battles show newest finished first (left to right) and are dimmed. A separate always-visible **New battle** action sits beside the rows (exactly ONE control per page, ever). Cards carry mini board maps with unit dots. Opening a game shows the 8×8 board and the two armies. |
| Store tab | Flavor page: "Coming soon…" over dark-fantasy dressing. Placeholder for a future real store (later hooks: where new themes and cosmetics would be sold). No functionality in MVP. |
| Statistics tab | Games played, wins, losses, win rate, and wins/losses per AI difficulty — computed from **finished game rows** (there is no separate history table). |
| Champions tab | A grid of the 6 unit classes: role badge (attacker/supporter), portrait **both sides** (two artworks), stat block, and a short lore paragraph — all served via `GET /api/meta` from the config. Sprites appear on the game board, not here. Static content, no interactivity beyond viewing. |
| Profile tab | Change username, change password. Also: pick the army visual theme (see Champions & themes). The picker lists themes from the config — one theme exists in MVP, so the picker works but shows a single option. |
| Concurrency cap | Max **5 active games** per player. |

## Core game design (decisions, all final for MVP)

### Armies
Both sides get the identical fixed army — no army editor in MVP:

- 2 × Swordsman, 2 × Axeman, 2 × Spearman, 2 × Archer, 1 × Mage, 1 × Healer (10 units per side, 20 total).

### Unit stats — single source of truth
All numbers live in **one JSON config file** (Unit stats, ranges, heal amount, difficulty personas + temperatures, board size, games cap — plus the lore strings and the AI-retry knobs; canonical shape in `01-architecture.md`). Game logic must read values from this file — stats are never hardcoded, inlined, or duplicated.

This is also where **balance-tuning happens later**: rebalancing = editing the file.

Starting values (chosen for readability of the config, details in `02-game-rules.md`):

| Class | Count | HP | Atk | Def | Mov | Attack range |
|---|---|---|---|---|---|---|
| Sword | 2 | 15 | 8 | 3 | 3 | 1 |
| Axe | 2 | 13 | 10 | 2 | 2 | 1 |
| Spear | 2 | 10 | 7 | 2 | 5 | 1 |
| Archer | 2 | 9 | 7 | 1 | 4 | exactly 2 |
| Mage | 1 | 9 | 9 | 1 | 3 | 1, 2 or 3 |
| Healer | 1 | 10 | — | 1 | 2 | heal 6, adjacent only |

### Rules of play
- **Turn flow:** your whole army acts per turn → the AI's whole army acts (async) → repeat. Per unit per turn: **move (up to Mov), then one action** — attack, heal (healer), or wait. Any unit order; the UI lists units in this default display order: Swords, Axes, Spears, Archers, Mage, Healer.
- **Counterattack:** after an attack, the defender counters **if and only if** the attacker's final tile lies inside the defender's own attack range, and the defender can attack (the Healer never counters).
- **Combat is deterministic:** `damage = Atk − Def` (floor at 0). No hit %, no crit %, no random bonuses. The Healer does not attack at all.
- **Movement & tiles:** units block movement of **enemies** but pass through **allies**; a unit can never end movement on an occupied tile.
- **Move preview:** selecting one of your units highlights on the board (a) every tile it can reach this turn and (b) from those tiles, the enemy tiles it could attack (or, for the Healer, the allies it could heal). Cosmetic overlays via the server preview endpoint; the visual is tile highlighting only — no animated route drawing (the staged move nevertheless includes a computed shortest path, see `05`).
- **Terrain is cosmetic in MVP, with one exception:** there are no terrain bonuses or penalties, BUT water is impassable — `lake`/`river` cannot be entered; `bridge` is the only water crossing. (Movement legality treats these two tiles specially; everything else is pure decoration.)
- **Victory condition:** kill **all 10** enemy units. (The defeat is symmetric: if all YOUR units die, you lose — both outcomes are recorded in stats.)

### Board generation
- 8×8 grid, always.
- Terrain palette: plain, forest, hill, lake, river, bridge (+ decorative rocks). Terrain types are cosmetic.
- **Zero or one** river line per board. A river is a connected path across the board with a few **turns** (never a straight canal, never spiraling into a flooded board). Only crossing points are the 1–2 bridges lying on it — riverless boards are possible (the designer may omit the river; then there are no bridges either).
- Spawn areas are **2 full rows of all 8 columns** on each side: player bottom (rows 6–7), enemy top (rows 0–1). Front rows face the middle.
- The river (when present), its bends, bridges and terrain zones come from a hybrid pipeline detailed in `03-board-generation.md`: the **LLM decides** the layout brief (river start/end and bends, bridge tiles, forest/hill/lake zones and their placements — the zones' radii ARE the density knob), **deterministic code materializes** the grid, then validates. No board is playable that violates the constraints.

### AI gaming (the meat)
- **Opponent moves are server-side policies (not LLM).** Each turn the server computes orders from engine-generated legal menus (paired attack/heal options and reachable moves) via a deterministic persona policy - Aggressive/Cowardly/Crazy (`aggressive`/`defensive`/`erratic`, `04-ai-integration.md`). Moves are always legal, produced in one shot (no LLM, no move retries, no hallucinated paths). Crazy (`erratic`) is stochastic over legal options; the others are deterministic given the snapshot. This is the authoritative move logic, not a fallback.
- **Difficulty personas** (3, names are placeholders, changeable in config): Aggressive / Cowardly / Crazy (ids `aggressive` / `defensive` / `erratic`). Different = different menu-choice policy. `config.personalities` keeps label/temperature metadata; temperature does not affect server-side moves.
- The **map designer** remains LLM-driven: a small structured call generates the layout brief for each new board (`03-board-generation.md`).
- **Async orientation:** AI turns run as background jobs in the backend (instant compute, persisted asynchronously); the frontend polls. A game whose AI turn stalled (e.g. server restarted) is re-triggered on games-list or game load. The implementation shape — fire-and-forget job + stale-recovery sweep — is defined in `01-architecture.md` Runtime model. No queues, no Redis, no websockets.

### Champions & themes
- **Side colors:** player = **white/gold**, enemy = **black/red** (both final).
- **Portraits:** distinct artwork per side (two images per class).
- **In-game sprites:** the same base design for both sides, tinted by side, for instant board readability.
- **Themes** (cosmetic army skin — e.g. classic European warriors, anime girls, anthropomorphic animals) are implemented as an **asset naming convention + manifest in the config**, not code. Adding a theme = adding files + config lines.
- **MVP ships exactly one theme:** classic European warriors.
- **Lore blurbs:** short, thematic/cultural, class-level text ("what this soldier is within the war"). Crucially: **no hero names, no individual backstories** — there are multiple soldiers of each class on the board. Drafted via LLM during the build (editable in the config).

### Assets pipeline
Art (portraits, sprites, future sounds) is **generated by the owner outside the build**, not by coding agents. Agents ship the asset pipeline with **placeholder images** in the agreed layout so the product runs complete from day one; the owner drops real art into the convention later. `07-assets.md` is therefore a contract, not a build task.

## Deferrals to "Later hooks" (do NOT build now, do not design around)

1. Weapon triangle (sword > axe > spear > sword), possibly shipped silently as an undocumented "secret" advantage — IF it is ever built, it enters via a future spec amendment first, never directly in code.
2. More army themes; player-selectable themes (MVP: fixed warrior theme).
3. Variable/chooseable board sizes and army sizes — tuning will depend on how the AI handles the calls. (Related: the deployed VM runs fully on the hunt's 1 OCPU / 6 GB shape — AI turns are slower there, per the "slow AI is atmospheric" decision. Growing the instance shape to the A1 allowance maximum (4 OCPU / 24 GB) is an OPTIONAL capacity upgrade attempted via stop → edit shape → start whenever Oracle's pool allows; failing that retry changes nothing and the game keeps running at 1/6.)
4. Email verification, password recovery email, 2FA.
5. Per-champion sound effects (plus VICTORY/DEFEAT fanfares — see the playbook's sound section for the pre-named file convention).
6. Richer win conditions (unique heroes, objective tiles), player-chosen army compositions.
7. Rating/ELO, leaderboards, global stats.
8. Higher concurrency cap / parallel LLM requests if players pile up. **RESPONSE-TIME DECISION (resolved for moves):** opponent move decisions are now server-side policies (instant, always-legal) — the LLM-move latency/spin/hallucination issues (schema bounds, `oneOf`, model tier) are moot for turns. The LLM remains only for **board design briefs** (~35–80 s on local CPU) during game creation; creation is already async (`generating_board` + polling). If brief latency ever feels unacceptable: (a) grow the deployed shape to 4 OCPU / 24 GB (hook 3, divides times), (b) swap `OLLAMA_MODEL` for briefs (one env line), or (c) accept the async wait. No move-path code depends on the model.
9. Persist the UI light/dark preference per account (currently localStorage-only).
10. **Board striker (Option 2):** swipe/slide between LIVE boards on one screen (instead of strip-with-links). Designed edge cases to honor when built: (a) switching mid-staging requires a "discard staged moves?" confirm — staged moves are client-local; (b) focused-game polling at 3 s vs summary badges of the others merge into one polling strategy; (c) board fetch per focus stays on endpoint 11 unchanged; (d) ordering must stay creation order (no reshuffling ever).
11. **Owner play-test feedback round** — the owner plays the built MVP (local stack), compiles ideas/suggestions, and triages them into spec amendments for the rebuild — per the standing strategy: **fix the docs first, then a fresh build with fixes baked in**.
12. Dedicated **test-folder restructure** — the current convention co-locates tests next to their source (`*.test.ts` beside modules, per `08`'s style section); a future rebuild may instead gather tests under dedicated `tests/` folders. Requires: one edit to `docs/08`'s style section + agents reorganizing the 30 test files. Chosen as a later hook (not now) per owner decision during phase 6/7 play-testing.
13. **Real Store implementation** — the Store tab ships as a "Coming soon…" flavor page in MVP; a real store (where new army themes and cosmetics would be sold) enters via future spec amendment — see the Store tab (product inventory).
14. **Phase 8 — Code refactor (prepared):** behavior-preserving stabilization/refactor pass (including remaining 8×8-migration test fallout) — spec prepared in `docs/09-build-order.md` and `docs/11-phase-8-code-refactor.md`; implementation pending.
15. **Phase 9 — UI refactor (prepared):** professional/responsive UI refactor and polish pass — spec prepared in `docs/09-build-order.md` and `docs/12-phase-9-ui-refactor.md`; implementation pending.

## Non-goals (never build in MVP)

No PvP multiplayer, no mobile app, no SSR/SEO machinery, no websockets, no message queues/Redis, no admin panel, no email infrastructure, no matchmaking/ELO, no internationalization (English only), no analytics/cookies tooling, no CI/CD (docker-compose is the deployment).

## Engineering non-negotiables (day 1, every phase)

- **Lint + format:** ESLint + Prettier configured in the scaffold phase, kept clean forever. A phase that fails lint or formatting is not done.
- **Tests:** unit tests (Vitest) + E2E (Playwright) exist from day 1. Depth where it matters, listed per phase in `09-build-order.md` — thorough on game rules/validation, light on UI plumbing. "Everything possible" means public behavior is covered, not 100%-coverage theater.
- **Responsive UI:** every screen is usable from phone width up. No separate build target, no heavy UI framework — standard CSS and a scaling board.
- **Git per phase:** each phase ends with one or more conventional-style commits scoped to that phase (no AI attribution) and a **push to the remote**. The owner creates the remote before phase 1.

## Glossary

- **Game** — one board, two armies, a persisted row whose state evolves.
- **Unit** — one soldier instance on the board; belongs to a class.
- **Class** — one of the 6 unit types (Sword, Axe, Spear, Archer, Mage, Healer).
- **Champion** — a class as seen in the Champions tab (role badge + both portraits + lore + stats, all served via `GET /api/meta` from the config).
- **Persona** — one of the 3 AI difficulty presets (prompt + temperature).
- **Role** — per-class tag in config (`attacker` = melee frontliner; `supporter` = fragile high-value backline: archers, mage, healer). A TARGETING tag, not a combat-function label (archers/mages still attack); consumed by the AI prompt layer (STATS kernel, personas) — never by engine math.
- **AI turn** — one background job that asks the LLM to produce one enemy army turn and validates it.
- **Config** — the single JSON file with all tunables (unit stats, personas, cap, board size, lore, AI knobs — canonical shape in `01`).
- **Brief** — the small structured JSON the LLM returns to describe a board layout before materialization.
