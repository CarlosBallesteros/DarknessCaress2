# Phase 9 — UI Refactor: Professional & Responsive (Preparation)

> **Status:** Prepared (docs-first). This phase improves visual quality, consistency, responsiveness, and usability of the existing frontend without changing game rules, backend contracts, or product scope.

## Goals

- Deliver a **professional, polished UI** with consistent layout, spacing, typography, and component states across all routes.
- Make the experience **responsive and usable** on mobile, tablet, and desktop (including the board/strip interactions) while preserving the established dark-fantasy tone and design tokens.
- Improve clarity and accessibility of key interactions (selection, overlays, staging, forms, navigation) without altering gameplay semantics or API usage.
- Keep implementation simple and aligned with current stack (`docs/01`, `docs/05`): React + plain CSS + tokens, no UI framework/library additions.

## Non-goals

- No gameplay, rules, balance, or API/DTO changes.
- No redesign of information architecture, routes, or feature set beyond presentation/usability refinements.
- No new dependencies (component libraries, CSS frameworks, animation libraries) unless explicitly ratified later via gap protocol/spec amendment.
- No real artwork creation; asset pipeline/placeholders/fallback behavior remain governed by `docs/07`.

## Preconditions / Inputs

- Read: `00-project-overview.md`, `01-architecture.md`, `05-frontend.md`, `06-api-contract.md`, `07-assets.md`, `08-agent-rules.md`, `09-build-order.md`, this doc.
- Current baseline: 8×8 board, full-width 2-row spawns, in-repo art sync, enemy-unit inspect (read-only), overlays rendered above terrain sprites, compact profile card, champions portrait lightbox at natural aspect ratio, minimap dots sized for legibility on smaller cards.
- All UI behavior must continue to reflect authoritative server state (`06`) and the interaction rules in `05`.

## Scope

### 1) Design system consolidation (CSS/tokens/components)

- Audit `client/src/styles/*` and shared components for inconsistent spacing, font sizes, radii, borders, shadows, and color usage; align to `tokens.css` and semantic variables.
- Define/standardize reusable patterns (buttons, inputs, cards, badges, banners, dialogs, tabs, tables, chips) with clear hover/focus/active/disabled/error states.
- Ensure light/dark UI modes remain coherent and token-driven (`data-ui-mode`), with no hardcoded one-off colors where tokens exist.
- Improve typographic hierarchy (headings, labels, metadata, body) using existing display/body font strategy; keep readability high.

### 2) Responsive layout and navigation

- **Global shell/top menu:** ensure tabs, wordmark/home link, mode toggle, username/logout wrap and remain usable at narrow widths (≤480 px and intermediate breakpoints); maintain tap targets and avoid overflow/clipping.
- **Games strip (`/play`):** responsive card sizing and row behavior; preserve creation order, status badges/pulse states, mini-map legibility, and the always-visible separate New battle action with cap-disabled state. Ensure horizontal scroll/snap works well on touch and desktop.
- **Board screen (`/play/:id`):** responsive composition of `PhaseBanner`, board, `UnitTray`, `ActionPanel`, `StagedMovesBar`, and `TurnFooter` so controls remain accessible without horizontal page scroll where feasible. Board tile sizing should adapt to viewport while keeping overlays/units/popups aligned and readable.
- **Stats/Champions/Profile/Store/Auth/Landing:** refine grids, cards, forms, and hero/sections for small and large screens; keep content centered/readable and actions easy to reach.
- **Dialogs/lightbox/modals:** ensure they fit viewports, scroll internally when needed, and remain dismissible/accessible (Esc/click where specified).

### 3) Interaction clarity and polish (behavior-preserving)

- Preserve documented state machine and semantics (`05`): staging, end-turn choreography, ghost/vacated rendering, error highlighting, enemy inspect (read-only, no move/action), AI-turn polling/animation, generating-board placeholder state.
- Improve visual affordances for selectable/selected/acted/staged/inspectable units and actionable tiles (move/attack/heal/path), ensuring contrast and visibility in both UI modes and over terrain sprites.
- Refine feedback states: loading/polling indicators, disabled reasons (e.g. cap reached), inline form validation/errors/success, confirm dialogs, and empty states—without changing messages/contracts.
- Verify portrait/lightbox, health bars, tray chips, and staged-move chips render cleanly at varied sizes.

### 4) Accessibility and quality baseline

- Maintain/strengthen keyboard operability for core flows where already supported; ensure visible focus states.
- Use semantic elements/labels/roles appropriately for interactive controls (buttons, links, inputs, dialogs) and preserve existing `data-testid` attributes (stable contract for E2E).
- Check color contrast for text/overlays/badges against backgrounds in both modes; avoid conveying state by color alone where practical within scope.
- Respect reduced-motion preferences for non-essential animations/pulses where easy to apply without behavior change.

## Constraints and guardrails

- **No contract or rules changes:** do not alter API calls, DTO assumptions, routes, polling semantics, or game interaction outcomes defined in `05`/`06`.
- **No `data-testid` renames/removals:** E2E relies on them (`05`).
- **Token- and CSS-first:** extend/refactor existing plain CSS and tokens; avoid inline-style sprawl except where already necessary for dynamic layout values.
- **Asset handling unchanged:** continue using `assetPath` helpers and placeholder fallbacks per `07`; do not hardcode asset paths.
- **Incremental and reversible:** small, reviewable commits; avoid risky rewrites of working interaction logic.

## Acceptance checklist

```
[ ] npm -w client run lint && npm -w client run build           → clean
[ ] npm -w client test                                           → green (existing suites; update/add only for UI logic if needed, behavior-preserving)
[ ] npm -w server run lint && npm -w server run build            → still clean (no unintended backend drift)
[ ] Responsive checks: key screens usable at narrow (~360px), tablet, and desktop widths without broken layout/overlap/unreachable controls
[ ] Games strip: snap/scroll, card content, mini-map, badges/pulses, New battle control/cap state behave as specified
[ ] Board screen: board/overlays/units/tray/panel/staged bar/footer usable and aligned across breakpoints; enemy inspect and staging rules preserved
[ ] Light and dark UI modes visually consistent; focus/hover/disabled states clear
[ ] No data-testid regressions; no API contract or gameplay behavior changes
[ ] Report states what was refactored, responsive decisions, files touched, and any gaps escalated
[ ] Conventional commits (e.g. refactor(phase-9): ... / style(phase-9): ...), no AI attribution, pushed
```

## Risks / watch-outs

- **Board responsiveness** is the hardest area (grid scaling, overlays, absolute-positioned units/popups, tray/panel space); validate carefully to avoid misalignment or hit-target issues.
- **CSS specificity/regressions:** shared class changes can affect multiple routes; test all primary screens after edits.
- **Overlay/terrain stacking and contrast:** preserve the "overlays above terrain sprites" fix and ensure visibility over varied tile art/placeholders.
- **Interaction regressions:** UI refactors around `GameBoard`/state presentation must not change reducer/state-machine outcomes or action staging semantics.

## Suggested execution breakdown

1. Audit current UI (routes/components/styles/tokens) and capture a prioritized issue list (consistency, responsiveness, accessibility).
2. Consolidate tokens and shared component styles/patterns with minimal markup churn.
3. Apply responsive layout fixes shell-first, then strip, board, and remaining pages.
4. Polish interaction states/affordances and verify light/dark modes.
5. Run client lint/build/tests, perform manual responsive smoke checks, and document results.
