# Prompts — the Owner's Playbook

> Copy-paste prompt blocks for running the whole project phase by phase, plus reusable interaction templates. Written LAST so it matches the frozen docs — **do not edit other docs to match this file again**; this file adapts if anything upstream changes.
>
> **How to run a phase:** you're running an AI coding agent with access to the repo. Pick the phase block, attach nothing manually — the prompt tells the agent which docs to read — paste, and let it work. After it claims done, run its phase checklist yourself (09) or at minimum spot-verify the git push.

## Ground rules for every run

- One agent, one phase, green checklist, commit+push, THEN the next phase. Never run two agents on the same repo simultaneously.
- Build strictly sequentially: 1 → 2 → 3 → 4 → 5 → 6 → 7. Every step's precondition is its predecessor's green checklist (see the WHEN/WAIT list under T1); nothing is parallel.
- If the agent stops with a "STOP / WHAT IS BLOCKING" report (gap protocol), answer it with template **T3** below.
- If something breaks AFTER a phase went green, use template **T2** (bug-fix), never a new phase.
- Automated test runs (Vitest/Playwright) are ALWAYS mocked — the test configs inject `LLM_MOCK=1` themselves; you never manage the switch for tests. For local dev, keep `LLM_MOCK=1` in your own `.env` (set once at phase 4); real-Ollama checks happen manually at phase 7 on the VM (the model is slow — the suite should not wait on it).

## Template T1 — standard phase prompt

```
You are working on Darkness Caress II (repo already cloned, on branch main).

MANDATORY ORDER:
1. Read docs/00-project-overview.md and docs/08-agent-rules.md in full. These are the
   constitution and your constraints — obey every MUST and MUST NOT.
2. Read your phase files: «PHASE_DOCS»
3. Read docs/09-build-order.md — you are building «PHASE_N» only; its acceptance
   checklist at the end of that section is your definition of done.

TASK:
Build «PHASE_N» of the project, exactly and ONLY as those documents specify.
- Implement every deliverable named in the 09 phase section; skip anything not listed.
- The repo may already contain prior phases' code — build on it, match its style,
  NEVER refactor or "improve" it beyond your phase's needs.
- If anything is ambiguous or missing, STOP and use the gap protocol shape from
  docs/08-agent-rules.md (it is a hard rule; do not guess).

QUALITY GATES (all mandatory before you claim done):
- lint + prettier clean on every touched package
- all tests green (unit + any this-phase E2E)
- conventional commits scoped to this phase (no AI attribution), pushed to the remote
- finish with a report: what you built, what you deliberately did NOT build, the
  acceptance checklist of 09 for «PHASE_N» with pass/fail shown, and any gaps escalated.
```

### Per-phase fill-ins

| Phase | «PHASE_N» | «PHASE_DOCS» |
|---|---|---|
| 1 | `Phase 1 — Scaffold & quality gates` | `docs/01-architecture.md`, `docs/07-assets.md`, `docs/09-build-order.md` |
| 2 | `Phase 2 — Auth & users` | `docs/01-architecture.md`, `docs/06-api-contract.md` |
| 3 | `Phase 3 — Rules engine (pure src/game/)` | `docs/02-game-rules.md` |
| 4 | `Phase 4 — Board generation` | `docs/03-board-generation.md`, `docs/04-ai-integration.md` |
| 5 | `Phase 5 — AI turns & remaining API` | `docs/02-game-rules.md`, `docs/04-ai-integration.md`, `docs/06-api-contract.md` |
| 6 | `Phase 6 — Frontend (whole website)` | `docs/05-frontend.md`, `docs/07-assets.md`, `docs/06-api-contract.md` |
| 7 | `Phase 7 — E2E + deployment` | `docs/01-architecture.md`, `docs/06-api-contract.md`, `docs/05-frontend.md`, `docs/04-ai-integration.md` |

(Note: `09-build-order.md` is already in every prompt's mandatory reading.)

**WHEN / WAIT checks before pasting:**

- Phase 1 → owner prerequisite only (Phase 0 done).
- Phase 2 → WAIT until Phase 1 green (`/api/health` boots, lint runs).
- Phase 3 → after Phase 2 (sequential rule; engine itself has no API deps, but the sequence is the rule).
- Phase 4 → WAIT for Phases 2 + 3 (needs auth middleware and the engine).
- Phase 5 → WAIT for Phase 4 (a game must exist before turns can run).
- Phase 6 → WAIT for Phase 2 (auth) minimum; touching game screen code assumes Phase 4/5 endpoints exist — sequential default keeps it simple: run after 5.
- Phase 7 → WAIT: everything is merged, all unit suites green.

## Template T2 — bug fix / follow-up after a green phase

```
You are fixing a defect in Darkness Caress II. Read docs/00-project-overview.md and
docs/08-agent-rules.md in full.

SYMPTOM: «describe exactly what you saw: what you did, what happened, expected»
LOCATION HINT: «the screen / endpoint / file where it showed»

TASK:
Reproduce, diagnose, fix. Do NOT redesign, do NOT touch anything outside the defect,
do NOT add features. If the root cause is in a doc decision (spec bug), STOP and use
the gap protocol instead of patching the spec yourself.

FIT CHECK (mandatory in your report): my root cause, why it happened, what the
regression test is (add one — a fix without a failing-first test is not a fix),
and what you did NOT touch.
Quality gates as always: lint, tests, conventional commit "fix: …", push.
```

## Template T3 — answering a gap-protocol report

```
Decision on «WHAT IS BLOCKING line»:
Choice: «A» (or «B», or your own if you reject both — then re-explain the constraints)
Decision rationale (one paragraph, so the agent can re-derive it): «why»
Also: if this is a PRODUCT decision (rules/UX/scope), I'll note it in the relevant
docs/xx file after this phase — remind me in your final report.
Proceed with this answer; all other spec parts remain unchanged.
```

(Owner habit worth keeping: after the phase is green, paste the decision into the right doc — one line — so the next agent never trips on the same gap.)

## Template T4 — asset work (owner-only)

Not for coding agents — this is your art production task, run with placeholders shipped. The full copy-paste kit (consistency method, per-class subjects, prompt seeds, save filenames, post-checks) is **Template T6 at the end of this file**. Division of law: `docs/07-assets.md` owns the *technical* contract (directory layout, pipeline rules, placeholder generator); **T6 owns art production and is the canonical home for it** — when art guidance changes, T6 changes; the technical contract changes only if file/naming/plumbing rules change.

## Template T5 — misc ops snippets you'll want

```
Run the whole test battery locally:
  npm -w server run lint && npm -w client run lint && npx prettier --check .
  npm -w server test && npm -w client test && npm run e2e

Spin the whole prod stack:  docker compose up -d
Watch a specific AI turn's logs:  docker compose logs -f server
Reset ONLY the database (keeps ollama model):
  docker compose down db && docker volume rm darknesscaress2_db_data && docker compose up -d db
Erase the 5GB model volume (do rarely; re-pulls on next start):
  docker compose down ollama && docker volume rm darknesscaress2_ollama_data
```

## After each phase — owner's 60-second check

1. `git pull` — commit messages conventional, scoped, no AI attribution.
2. Run the phase checklist block (09) yourself or read the agent's pass/fail report.
3. Spot-check ONE thing the checklist lists (never trust, verify).
4. Only then paste the next phase prompt.

## Template T6 — Art production kit (owner-only; THE canonical home for art guidance)

`07-assets.md` is the technical contract — directory layout, pipeline rules, placeholder generator. This template is where art production knowledge lives. When art requirements change, change T6 here (and `07` only if file/naming/plumbing is affected).

### A. Contract rules (satisfy ALL — the pipeline and placeholders depend on them)

- **Output format:** PNG with alpha (RGBA) always; transparent background for sprites; convert from your tool's format if needed.
- **Filenames:** lower-case, exact, never renamed. One file per side where sides exist.
- **File set per theme** (`<themeId>` — baseline: `warriors-europe`), under `client/public/assets/`:
  - `hero/landscape.png` — 1920×1080 max, landing backdrop (may be opaque).
  - Per class key in `config.classes` (baseline: `sword`, `axe`, `spear`, `archer`, `mage`, `healer`):
    - `portrait-player.png` — 512×512 — white/gold artwork.
    - `portrait-enemy.png` — 512×512 — black/red artwork, **DIFFERENT art** from the player's (two artworks per class, same archetype).
    - `sprite-player.png` — 128×128 — board sprite (color as-is).
    - `sprite-enemy.png` — 128×128 — SAME design as sprite-player, recolored black/red.
- **Save location rule:** `client/public/assets/warriors-europe/<class>/<file>.png`. Nothing else changes — no code edits, no config edits; the loader picks files up as they appear and the placeholder fallback covers what's missing.
- Incremental is fine: ship 3 classes today, the rest next weekend — `console.warn`s on a board mean "still using placeholders", nothing worse.

### B. Consistency kit (do this BEFORE writing prompts)

1. Generate **all 6 portraits of ONE side** inside a single chat/run, always referencing the first accepted image ("same painterly style, same armor language, same background value"), so the set reads as one artist's roster.
2. Then repeat for the other side (new run, but re-anchor on the same archetypes).
3. Sprites last: either derive from the accepted portrait as a style seed, or generate with the same reference phrase — then recolor one base sprite per class to make the two side files (recolor ships BOTH files; don't rely on the tool's "variation" for the enemy side).

### C. Per-side palettes (the rule from `00`)

- **Player:** white and gold ornate armor, light background values, heroic poses.
- **Enemy:** black lacquered armor + deep red accents, darker background values, menacing poses.
- **Constant across sides:** same silhouette language per class — the board reader identifies *class by shape*, *side by tint*.

### D. Per-class subjects (silhouette first — the board shows them at ~40 px)

- `sword` — disciplined warrior, longsword + kite shield, balanced stance.
- `axe` — broad-shouldered brute, two-handed great axe, heavy bulk.
- `spear` — lithe skirmisher, longspear, lighter armor.
- `archer` — mobile bowman, strung bow, quiver visible, no sword.
- `mage` — fragile scholar, gnarled staff with faint glow, bareheaded.
- `healer` — gentle field-medic silhouette, small staff, vial harness, clearly non-combatant.

### E. Prompt seeds (adapt freely; tools of your choice)

- **Portrait:** `"dark fantasy oil painting portrait, [SUBJECT], [SIDE PALETTE], dramatic rim light, simple dark background, centered bust, 512×512"` — 1:1 aspect.
- **Sprite:** `"full body game sprite of [SUBJECT], dark fantasy painterly style, neutral pose, front view, flat simple background, centered, 1:1"` — crop tight; big readable shapes beat detail at board size.

### F. Post-check (60 seconds after any art drop)

1. All new files RGBA PNG, exact names, in the right directories (`<themeId>/<class>/…`).
2. Open `/champions` — 6 role-badged cards render portraits (both sides).
3. Open any game board — sprites sit inside tiles at ~40 px, player/enemy readable.
4. Zero broken-image icons; `console.warn`s only for classes you haven't drawn yet.

### G. Sound (later hook — same convention when it lands)

`<themeId>/<class>/sound-<action>.mp3`, short effects (<0.5 s): e.g. `sound-attack.mp3`, `sound-heal.mp3`. The loader convention extends; no code re-architecture.
