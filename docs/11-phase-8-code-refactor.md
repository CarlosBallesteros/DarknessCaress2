# Phase 8 — Code Refactor (Preparation)

> **Status:** Prepared (docs-first). This phase is a behavior-preserving refactor and test-stabilization pass. It MUST NOT change product behavior, game rules, API contracts, config semantics, or UI-visible copy except where required to fix defects already identified as out-of-spec inconsistencies (none are pre-approved here — follow the gap protocol if found).

## Goals

- Stabilize the codebase after recent feature changes (notably 8×8/full-width spawn migration) so quality gates are green and trustworthy.
- Improve maintainability, readability, and consistency while preserving the existing architecture and boundaries (`docs/01`, `docs/08`).
- Reduce duplication and fragile assumptions (hardcoded coordinates/sizes in tests/helpers) without introducing speculative abstractions.
- Keep the pure rules engine (`server/src/game/`) I/O-free and deterministic; keep features thin over engine/board/ai modules.

## Non-goals

- No new gameplay mechanics, balance changes, endpoint changes, schema migrations, or visual redesign.
- No dependency additions/upgrades, framework changes, queues/websockets, or architectural rewrites.
- No "plugin systems", generic frameworks-inside-the-project, or broad renames/reorganization beyond what clearly improves the touched code.
- No artwork generation or asset-pipeline behavior changes beyond what is necessary for correctness (and documented).

## Preconditions / Inputs

- Read: `00-project-overview.md`, `01-architecture.md`, `02-game-rules.md`, `03-board-generation.md`, `04-ai-integration.md`, `06-api-contract.md`, `08-agent-rules.md`, `09-build-order.md`, this doc.
- Baseline facts (current): server build/lint pass; client build passes; board/config/meta/reach/board-generation suites targeted recently pass; **`npm -w server test` is not fully green** (known 8×8 coordinate/assumption fallout in parts of `server/src/game/apply.test.ts`, `server/src/features/ai/aiTurn.test.ts`, `server/src/features/ai/mockLlm.test.ts`, and portions of `server/src/features/games/turnEndpoints.test.ts`, plus any other failures discovered during the phase).
- API and engine behavior defined by `02`/`06` remain the source of truth; tests must be updated to match the documented 8×8/full-width spawn reality, not vice versa, unless a real rule/contract bug is proven.

## Scope (ordered)

### 1) Test stabilization and correctness (highest priority)

- **Audit and fix failing server tests** caused by 8×8 migration assumptions:
  - Replace stale coordinates, row/column expectations, board-size literals, and spawn-position assumptions with values derived from `config.boardSize` / engine config and current spawn/layout rules (`docs/03`).
  - Ensure fixtures and helpers construct valid 8×8 states (e.g. `server/src/features/ai/serialize.test.ts`-style updates already done; extend consistently to `aiTurn`, `mockLlm`, turn endpoint scenarios, apply/reach/game tests where needed).
  - Keep test intent intact: scenarios should still validate the same rule/contract behavior (atomicity, legality, counters, turn transitions, preview, AI application, stale/job behavior), adapted to valid positions on 8×8.
- **Do not weaken assertions** to "make tests pass" (no removing checks, broadening expected outcomes, or skipping cases) except to correct assertions that encoded obsolete 15×15 geometry.
- Re-run targeted suites after each fix cluster, then full server tests, then client tests.

### 2) Refactor hotspots (behavior-preserving)

Target only code that is hard to reason about or clearly duplicated; prefer small, local improvements:

- **Board/generation/spawn/invariants:** clarify naming/helpers around spawn rows/columns and size-derived bounds; remove dead or misleading compatibility remnants only when safe and covered by tests.
- **AI turn and game endpoints/jobs:** reduce duplication in state loading/persistence/validation paths where obvious; keep transactional/conditional-persist guarantees and "once-per-round"/job-guard semantics unchanged (`01`, `04`, `06`).
- **Client board interaction state (`client/src/routes/GameBoard.tsx`, `client/src/state/*`):** simplify selection/inspect/staging branching if it improves clarity, preserving the documented interaction rules (`05`) including enemy inspect and valid attack/heal staging.
- **Shared helpers/types:** consolidate repeated geometry/occupancy/formatting logic where it already exists in multiple places, provided it does not blur module boundaries.

### 3) Consistency and hygiene

- Align identifiers/comments with current reality (8×8, full-width spawn) where stale; keep comments WHY-focused per `08`.
- Remove dead code/unused imports/obsolete TODOs discovered in touched areas.
- Ensure lint/format/build remain clean in both packages; keep TypeScript strict and explicit at boundaries.

## Constraints and guardrails

- **Contracts are frozen:** `docs/06-api-contract.md` paths/statuses/bodies/messages must not change. Engine rules in `docs/02` and board invariants/spawn semantics in `docs/03` must not change.
- **Config-driven:** no new balance/size/timing literals in code; derive from config/engine config as today.
- **Boundaries:** `server/src/game/` stays pure (no feature/db/http imports). Features import from `game/`, not vice versa.
- **Determinism:** seeded materialization/spawn behavior must remain reproducible for the same inputs.
- **Small steps:** prefer incremental commits scoped to coherent refactors/fixes; each step should keep the tree buildable.

## Acceptance checklist

```
[ ] npm -w server run lint && npm -w client run lint            → 0 errors
[ ] npx prettier --check .                                       → clean (or project-standard equivalent)
[ ] npm -w server test                                           → all green
[ ] npm -w client test                                           → all green
[ ] npm -w server run build && npm -w client run build           → clean
[ ] No changes to docs/06 API contract, docs/02 rules, or config semantics (except doc clarifications already ratified)
[ ] 8x8/full-width spawn behavior and AI/turn/job semantics unchanged and covered by passing tests
[ ] server/src/game/ has no imports from features/ or I/O modules
[ ] Report lists: fixed failures, refactors performed, files touched, and any gaps escalated (none silently filled)
[ ] Conventional commits (e.g. refactor(phase-8): ... / test(phase-8): ...), no AI attribution, pushed
```

## Risks / watch-outs

- **Hidden geometry assumptions** in tests/helpers/end-to-end fixtures can mask real bugs; verify intent before changing expectations.
- **Turn/job atomicity and stale recovery** are sensitive; refactors must preserve conditional updates, guards, and retry/sweep behavior.
- **Client interaction flow** has subtle staging/inspect precedence; avoid regressions in valid attack/heal actions while enabling enemy inspection.
- Large test rewrites can drift from contract intent—prefer deriving positions from helpers/config and keeping scenario meaning explicit.

## Suggested execution breakdown

1. Triage all current server test failures and group by root cause (geometry, spawn rows, path legality, turn/job state assumptions).
2. Fix geometry/spawn-derived failures in engine/board/ai/endpoint tests with minimal, intention-preserving edits.
3. Run full server suite to green; fix any newly revealed issues.
4. Apply focused refactors in identified hotspots; keep each commit test-backed.
5. Run full quality gates (lint, format check, tests, builds) and document outcomes.
