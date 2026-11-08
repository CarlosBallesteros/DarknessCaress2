# Prompts — the Owner's Playbook

> Copy-paste prompt blocks for running the whole project phase by phase, plus reusable interaction templates. Written LAST so it matches the frozen docs — **do not edit other docs to match this file again**; this file adapts if anything upstream changes.
>
> **How to run a phase:** you're running an AI coding agent with access to the repo. Pick the phase block, attach nothing manually — the prompt tells the agent which docs to read — paste, and let it work. After it claims done, run its phase checklist yourself (09) or at minimum spot-verify the git push.

## Ground rules for every run

- One agent, one phase, green checklist, commit+push, THEN the next phase. Never run two agents on the same repo simultaneously.
- Phases 2 and 3 are the only parallelizable pair (see `09`); if you parallelize, run them in separate clones and merge yourself — default advice: don't.
- If the agent stops with a "STOP / WHAT IS BLOCKING" report (gap protocol), answer it with template **T3** below.
- If something breaks AFTER a phase went green, use template **T2** (bug-fix), never a new phase.
- Keep `LLM_MOCK=1` during development; set every real-Ollama check manually at phase 7 (the model is slow — the suite should not wait on it).

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
- Phase 3 → WAIT only for Phase 1 (engine has no API deps). Parallel-safe with Phase 2.
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

## Template T4 — asset generation (owner-only, image tool of your choice)

Not for coding agents. Phase 7 check may proceed with placeholders; art drops in any time after.

```
Portrait run (one side at a time, keep the SAME chat for all 6 so style stays consistent):
"dark fantasy oil painting portrait, [SUBJECT], [SIDE PALETTE], dramatic rim light,
simple dark background, centered bust, 512x512"
SUBJECT per class:
  sword — a disciplined warrior holding a longsword and kite shield, balanced stance
  axe   — a broad-shouldered brute with a two-handed great axe
  spear — a lithe skirmisher with a longspear, lighter armor
  archer — a mobile bowman, bow strung, quiver visible
  mage  — a fragile scholar, gnarled staff with a faint glow, no helmet
  healer — a gentle field-medic silhouette, small staff, vial harness
SIDE PALETTE: player = "white and gold ornate armor"; enemy = "black lacquered armor with deep red accents, menacing"
Then per accepted portrait: "full body game sprite of the SAME character, same armor and palette,
neutral pose, front view, flat simple background, centered, 1:1"
Save as: client/public/assets/warriors-europe/<class>/portrait-player.png / portrait-enemy.png /
sprite-player.png / sprite-enemy.png (exact names from docs/07-assets.md).
```

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
